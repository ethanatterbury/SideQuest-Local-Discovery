import { readFile, mkdir, writeFile } from "node:fs/promises";
import { loadProvider } from "./lib/provider-loader.mjs";
import { englandCoverage } from "./lib/england-coverage.mjs";
const { normalizeOsmResponse } = loadProvider("src/providers/nearby-places.ts");
const { withStoredPhoto } = loadProvider("src/providers/venue-media.ts");
const { optionalCategory } = loadProvider("src/domain/venue-suitability.ts");
const source = JSON.parse(
  await readFile(
    process.argv[2] || "src/providers/data/regional-osm.json",
    "utf8",
  ),
);
const places = normalizeOsmResponse(source).map(withStoredPhoto);
const report = {
  generatedAt: new Date().toISOString(),
  coverage: englandCoverage(source),
  normalizedPlaces: places.length,
  preparedPhotos: places.filter((p) => p.image).length,
  photoCoverage: places.length
    ? places.filter((p) => p.image).length / places.length
    : 0,
  optInCategories: Object.fromEntries(
    ["food", "pubs", "fitness", "shops"].map((c) => [
      c,
      places.filter((p) => optionalCategory(p) === c).length,
    ]),
  ),
  primaryExperiences: places.filter((p) => p.experiences?.length).length,
  sources: source.sources,
  limits:
    "Prepared metadata only. Image delivery, venue quality and live completeness are not established by this audit.",
};
await mkdir("work/england", { recursive: true });
await writeFile(
  "work/england/catalog-audit.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
