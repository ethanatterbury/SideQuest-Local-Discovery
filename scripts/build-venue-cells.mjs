import { readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { loadProvider } from "./lib/provider-loader.mjs";

const root = new URL("../", import.meta.url).pathname;
const { normalizeOsmResponse } = loadProvider("src/providers/nearby-places.ts");
const { cellId, inUK } = loadProvider("src/domain/geo-cells.ts");
const { withStoredPhoto } = loadProvider("src/providers/venue-media.ts");
const output = path.join(root, "public/data/venues");
await mkdir(output, { recursive: true });
const supplied = process.argv.slice(2);
const files = supplied.length ? supplied : ["src/providers/data/regional-osm.json", ...(await readdir(path.join(root, "src/providers/data/regions")).catch(() => [])).filter(f => f.endsWith(".json")).map(f => "src/providers/data/regions/" + f)];
const cells = new Map(), ids = {}, sourceDates = [], sources = new Set();
for (const file of files) {
  const data = JSON.parse(await readFile(path.resolve(root, file), "utf8"));
  sourceDates.push(data.generatedAt);
  for (const source of data.sources || []) sources.add(source);
  for (const raw of normalizeOsmResponse(data)) {
    if (!inUK(raw.coordinates)) continue;
    const place = withStoredPhoto(raw), id = cellId(place.coordinates);
    const records = cells.get(id) || new Map();
    records.set(place.id, place); cells.set(id, records); ids[place.id] = id;
  }
}
const manifest = { version: 2, generatedAt: sourceDates.filter(Boolean).sort().at(-1) || null, copyright: "© OpenStreetMap contributors, ODbL 1.0", sources: [...sources], cells: {} };
for (const [id, records] of cells) {
  const body = JSON.stringify({ version: 2, places: [...records.values()] });
  const hash = createHash("sha256").update(body).digest("hex").slice(0, 12);
  await writeFile(path.join(output, id + ".json"), body);
  manifest.cells[id] = { count: records.size, hash };
}
for (const file of await readdir(output)) if (/^\d+_-?\d+\.json$/.test(file) && !cells.has(file.slice(0, -5))) await rm(path.join(output, file));
await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest));
await writeFile(path.join(output, "id-index.json"), JSON.stringify(ids));
console.log(`Prepared ${Object.keys(ids).length} UK venues in ${cells.size} geographic cells; no network requests.`);
