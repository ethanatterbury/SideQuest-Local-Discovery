/** Free, repeatable media preparation. Browsing and recommendation order never wait for this job. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
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
const { resolveOfficialPhotos, downloadOfficialPhoto } = loadProvider(
  "src/providers/official-photo.ts",
);
const { placePhotoQuery, indexedPhoto } = loadProvider(
  "src/providers/photo-index.ts",
);
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
    !saved.has(place.id) &&
    (indexedPhoto(placePhotoQuery(place))?.image ||
      !/openstreetmap\.org/.test(place.website)),
);
const selected = candidates.slice(
  Number(options.offset || 0),
  Number(options.offset || 0) + Number(options.limit || 200),
);
const folder = "work/media-import";
await mkdir(folder, { recursive: true });
const added = [];
let cursor = 0;
await Promise.all(
  Array.from({ length: Math.min(6, selected.length) }, async () => {
    while (cursor < selected.length) {
      const place = selected[cursor++],
        query = placePhotoQuery(place);
      const indexed = indexedPhoto(query)?.image;
      const photos = indexed
        ? [indexed]
        : (await resolveOfficialPhotos(query)).candidates;
      for (const photo of photos.slice(0, 6)) {
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
  const stamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14);
  execFileSync("tar", [
    "-czf",
    `src/providers/data/venue-media-assets/photos-${stamp}.tar.gz`,
    "-C",
    folder,
    ...added,
  ]);
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
