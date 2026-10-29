import { writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { loadProvider } from "./lib/provider-loader.mjs";
import {
  discoverCatalogueSources,
  readCatalogueSource,
} from "./lib/catalogue-sources.mjs";

const root = new URL("../", import.meta.url).pathname;
const { normalizeOsmResponse } = loadProvider("src/providers/nearby-places.ts");
const { cellId, inUK } = loadProvider("src/domain/geo-cells.ts");
const { withStoredPhoto } = loadProvider("src/providers/venue-media.ts");
const output = path.join(root, "public/data/venues");
const compress = promisify(gzip);
await mkdir(output, { recursive: true });
const supplied = process.argv.slice(2);
const files = await discoverCatalogueSources(root, supplied);
const cells = new Map(),
  ids = {},
  placeSourceDates = new WeakMap(),
  sourceDates = [],
  sources = new Set();
for (const file of files) {
  const data = await readCatalogueSource(root, file);
  sourceDates.push(data.generatedAt);
  for (const source of data.sources || []) sources.add(source);
  for (const raw of normalizeOsmResponse(data)) {
    if (!inUK(raw.coordinates)) continue;
    const place = withStoredPhoto(raw),
      id = cellId(place.coordinates);
    const records = cells.get(id) || new Map();
    if (ids[place.id] && ids[place.id] !== id)
      cells.get(ids[place.id])?.delete(place.id);
    records.set(place.id, place);
    // Ownership follows the exact winning source record, including old sources.
    placeSourceDates.set(place, data.generatedAt || null);
    cells.set(id, records);
    ids[place.id] = id;
  }
}
const manifest = {
  version: 2,
  generatedAt: sourceDates.filter(Boolean).sort().at(-1) || null,
  copyright: "© OpenStreetMap contributors, ODbL 1.0",
  sources: [...sources],
  cells: {},
};
for (const [id, records] of cells) {
  const sourceDates = Object.fromEntries(
    [...records.values()].map((place) => [
      place.id,
      placeSourceDates.get(place),
    ]),
  );
  const body = JSON.stringify({
    version: 2,
    places: [...records.values()],
    sourceDates,
  });
  const hash = createHash("sha256").update(body).digest("hex").slice(0, 12);
  await writeFile(path.join(output, id + ".json"), body);
  await writeFile(
    path.join(output, id + ".json.gz"),
    await compress(body, { level: 9 }),
  );
  manifest.cells[id] = { count: records.size, hash };
}
for (const file of await readdir(output))
  if (
    /^\d+_-?\d+\.json(?:\.gz)?$/.test(file) &&
    !cells.has(file.replace(/\.json(?:\.gz)?$/, ""))
  )
    await rm(path.join(output, file));
await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest));
await writeFile(path.join(output, "id-index.json"), JSON.stringify(ids));
console.log(
  `Prepared ${Object.keys(ids).length} UK venues in ${cells.size} geographic cells; no network requests.`,
);
