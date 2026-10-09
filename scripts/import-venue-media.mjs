/** Free, repeatable media preparation. Browsing and recommendation order never wait for this job. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { loadProvider } from "./lib/provider-loader.mjs";
const options = Object.fromEntries(
  process.argv.slice(2).map((value) => {
    const [key, ...parts] = value.replace(/^--/, "").split("=");
    return [key, parts.join("=")];
  }),
);
const { normalizeOsmElement } = loadProvider("src/providers/nearby-places.ts");
const { PLACES } = loadProvider("src/providers/places.ts");
const { downloadOfficialPhoto } = loadProvider(
  "src/providers/official-photo.ts",
);
const { placePhotoQuery, indexedPhoto } = loadProvider(
  "src/providers/photo-index.ts",
);
const { approvedPhoto } = loadProvider("src/providers/photo-policy.ts");
const stamp = new Date()
  .toISOString()
  .replace(/[^0-9]/g, "")
  .slice(0, 14);
const archiveName = `photos-${stamp}.tar.gz`;
const snapshot = JSON.parse(
  await readFile("src/providers/data/regional-osm.json", "utf8"),
);
const catalogue = [
  ...PLACES,
  ...snapshot.elements.map(normalizeOsmElement).filter(Boolean),
];
const indexPath = "src/providers/data/venue-media.json";
const index = JSON.parse(await readFile(indexPath, "utf8"));
const saved = new Map(index.entries.map((entry) => [entry.id, entry]));
const candidates = catalogue.filter(
  (place) =>
    !approvedPhoto(saved.get(place.id)?.image, index.generatedAt) &&
    approvedPhoto(indexedPhoto(placePhotoQuery(place))?.image),
);
const selected = candidates.slice(
  Number(options.offset || 0),
  Number(options.offset || 0) +
    Math.min(25, Math.max(0, Number(options.limit || 10))),
);
// Manifest-only by default: no network sourcing or downloads without explicit opt-in.
if (options.download !== "true") {
  await mkdir("work", { recursive: true });
  await writeFile(
    "work/photo-preparation-manifest.json",
    JSON.stringify(
      {
        version: 1,
        entries: selected.map((place) => ({
          query: placePhotoQuery(place),
          image: indexedPhoto(placePhotoQuery(place))?.image,
        })),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      prepared: selected.length,
      downloaded: 0,
      manifest: "work/photo-preparation-manifest.json",
    }),
  );
  process.exit(0);
}
const started = Date.now();
const folder = "work/media-import";
await mkdir(folder, { recursive: true });
const added = [];
let cursor = 0;
await Promise.all(
  Array.from({ length: Math.min(3, selected.length) }, async () => {
    while (cursor < selected.length && Date.now() - started < 60000) {
      const place = selected[cursor++],
        query = placePhotoQuery(place);
      const indexed = indexedPhoto(query)?.image;
      const approved = approvedPhoto(indexed);
      const photos = approved ? [approved] : [];
      for (const photo of photos.slice(0, 1)) {
        const downloaded = await downloadOfficialPhoto(photo.url);
        if (!downloaded) continue;
        try {
          const decoded = sharp(downloaded.buffer, {
            limitInputPixels: 40_000_000,
            failOn: "error",
          }).rotate();
          const info = await decoded.metadata(),
            stats = await decoded.stats();
          if (
            !info.width ||
            !info.height ||
            info.width < 400 ||
            info.height < 250 ||
            info.width / info.height > 4 ||
            info.height / info.width > 3 ||
            stats.entropy < 4.6 ||
            (info.hasAlpha && stats.channels[3]?.mean < 220)
          )
            continue;
          const { data, info: encoded } = await decoded
            .resize({ width: 1280, withoutEnlargement: true })
            .webp({ quality: 78 })
            .toBuffer({ resolveWithObject: true });
          const file = `${place.id}-${createHash("sha256").update(data).digest("hex").slice(0, 12)}.webp`;
          await writeFile(`${folder}/${file}`, data);
          const blur = await sharp(data)
            .resize({ width: 20 })
            .webp({ quality: 25 })
            .toBuffer();
          saved.set(place.id, {
            id: place.id,
            name: place.name,
            lat: query.lat,
            lng: query.lng,
            originalUrl: photo.url,
            archive: archiveName,
            image: {
              ...photo,
              url: `/venue-images/${file}`,
              width: encoded.width,
              height: encoded.height,
              blurDataURL: `data:image/webp;base64,${blur.toString("base64")}`,
            },
          });
          added.push(file);
          break;
        } catch {
          /* A broken or unsuitable image cannot become a stored venue photograph. */
        }
      }
    }
  }),
);
if (added.length) {
  await mkdir("src/providers/data/venue-media-assets", { recursive: true });
  // A small portable tar bundle, created without a shell or unrestricted extraction.
  const parts = [];
  for (const file of added) {
    const data = await readFile(`${folder}/${file}`);
    const header = Buffer.alloc(512);
    header.write(file, 0, 100, "utf8");
    header.write("0000644\0", 100, 8, "ascii");
    header.write("0000000\0", 108, 8, "ascii");
    header.write("0000000\0", 116, 8, "ascii");
    header.write(
      data.length.toString(8).padStart(11, "0") + "\0",
      124,
      12,
      "ascii",
    );
    header.write(
      Math.floor(Date.now() / 1000)
        .toString(8)
        .padStart(11, "0") + "\0",
      136,
      12,
      "ascii",
    );
    header.fill(32, 148, 156);
    header[156] = 48;
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    const checksum = header.reduce((sum, value) => sum + value, 0);
    header.write(
      checksum.toString(8).padStart(6, "0") + "\0 ",
      148,
      8,
      "ascii",
    );
    parts.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  const tar = Buffer.concat(parts);
  if (tar.length > 64 * 1024 * 1024)
    throw new Error("Photo preparation exceeded bundle budget");
  const bundle = gzipSync(tar);
  if (bundle.length > 16 * 1024 * 1024)
    throw new Error("Photo preparation exceeded compressed bundle budget");
  await writeFile(
    `src/providers/data/venue-media-assets/${archiveName}`,
    bundle,
  );
  index.generatedAt = new Date().toISOString();
  index.entries = [...saved.values()];
  await writeFile(indexPath, JSON.stringify(index, null, 2) + "\n");
}
console.log(
  JSON.stringify({
    tested: selected.length,
    added: added.length,
    stored: saved.size,
    remaining: candidates.length - added.length,
  }),
);
