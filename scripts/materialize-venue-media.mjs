/** Materialize only approved photos; preserved source archives remain evidence. No network. */
import { readdir, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { loadProvider } from "./lib/provider-loader.mjs";
const root = new URL("../", import.meta.url);
const archives = new URL("src/providers/data/venue-media-assets/", root);
const destination = new URL("public/venue-images/", root);
await mkdir(destination, { recursive: true });
const media = JSON.parse(
  await readFile(new URL("src/providers/data/venue-media.json", root), "utf8"),
);
const { approvedPhoto } = loadProvider("src/providers/photo-policy.ts");
const approved = media.entries.flatMap((entry) => {
  const image = approvedPhoto(entry.image, media.generatedAt);
  return image ? [{ ...entry, image }] : [];
});
const wanted = new Set(
  approved
    .map((entry) => entry.image.url.split("/").at(-1))
    .filter((file) => /^[a-z0-9-]+-[a-f0-9]{12,16}\.webp$/.test(file)),
);
// The migration bootstrap is confined to the three existing licensed bundles.
// Future prepared records specify their archive, after the same rights gate.
const allowedArchives = new Set([
  "photos-commons-000.tar.gz",
  "photos-commons-001.tar.gz",
  "photos-commons-002.tar.gz",
  ...approved.map((entry) => entry.archive).filter(Boolean),
]);
for (const file of await readdir(archives).catch(() => [])) {
  if (!allowedArchives.has(file) || !/^photos-[a-z0-9-]+\.tar\.gz$/.test(file))
    continue;
  const compressed = await readFile(new URL(file, archives));
  if (compressed.length > 16 * 1024 * 1024)
    throw new Error(`Oversized photo bundle: ${file}`);
  const tar = gunzipSync(compressed, { maxOutputLength: 64 * 1024 * 1024 });
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    const member = header
      .subarray(0, 100)
      .toString("utf8")
      .replace(/\0.*$/, "");
    if (!member) break;
    const size = Number.parseInt(
      header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim(),
      8,
    );
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      offset + 512 + size > tar.length
    )
      throw new Error(`Invalid photo bundle: ${file}`);
    const type = header[156];
    if (wanted.has(member) && (type === 0 || type === 48)) {
      if (size > 4 * 1024 * 1024) throw new Error(`Oversized photo: ${member}`);
      await writeFile(
        new URL(member, destination),
        tar.subarray(offset + 512, offset + 512 + size),
      );
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
}
// Remove previously generated public copies which no longer pass the reuse policy.
for (const entry of media.entries) {
  const file = entry.image.url.split("/").at(-1);
  if (/^[a-z0-9-]+-[a-f0-9]{12,16}\.webp$/.test(file) && !wanted.has(file))
    await rm(new URL(file, destination), { force: true });
}
const { PLACES } = loadProvider("src/providers/places.ts");
const { indexedPhoto, placePhotoQuery } = loadProvider(
  "src/providers/photo-index.ts",
);
const prepared = new Map(approved.map((entry) => [entry.id, entry]));
const seed = PLACES.flatMap((place) => {
  const entry = prepared.get(place.id);
  const matching =
    entry &&
    entry.name === place.name &&
    Math.abs(entry.lat - place.coordinates.lat) < 0.0001 &&
    Math.abs(entry.lng - place.coordinates.lng) < 0.0001;
  const image = matching
    ? entry.image
    : indexedPhoto(placePhotoQuery(place))?.image;
  return image ? [{ id: place.id, image }] : [];
});
await writeFile(
  new URL("src/providers/data/seed-venue-media.json", root),
  JSON.stringify({ entries: seed }) + "\n",
);
// Portable metadata for a future free CDN: source, license, identity, checkedAt retained.
await mkdir(new URL("public/data/photos/", root), { recursive: true });
await writeFile(
  new URL("public/data/photos/manifest.json", root),
  JSON.stringify({
    version: 1,
    generatedAt: media.generatedAt,
    entries: approved,
  }) + "\n",
);
console.log(
  JSON.stringify({
    approved: approved.length,
    excluded: media.entries.length - approved.length,
    seed: seed.length,
  }),
);
