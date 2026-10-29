import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";

const decompress = promisify(gunzip);
const regions = "src/providers/data/regions";

/** Match cell publication: the last source owns each stable venue ID. */
export function canonicalCataloguePlaces(places) {
  if (!Array.isArray(places)) throw new Error("Expected catalogue places");
  const current = new Map();
  for (const place of places) {
    if (typeof place?.id !== "string" || !place.id.trim())
      throw new Error("Invalid catalogue venue ID");
    current.set(place.id, place);
  }
  return [...current.values()];
}

/** Share the same durable OSM sources between production cells and photo batches. */
export async function discoverCatalogueSources(root, supplied = []) {
  if (supplied.length) return [...supplied];
  const names = await readdir(path.resolve(root, regions)).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const available = new Set(names);
  const selected = names
    .filter(
      (name) =>
        name.endsWith(".json.gz") ||
        (name.endsWith(".json") && !available.has(name + ".gz")),
    )
    .sort();
  return [
    "src/providers/data/regional-osm.json",
    ...selected.map((name) => regions + "/" + name),
  ];
}

export async function readCatalogueSource(root, file) {
  const contents = await readFile(path.resolve(root, file));
  const json = file.endsWith(".gz") ? await decompress(contents) : contents;
  return JSON.parse(json.toString("utf8"));
}
