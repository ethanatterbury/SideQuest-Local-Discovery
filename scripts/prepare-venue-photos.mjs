/** Read official-site HTML offline and persist URL/evidence metadata, never image bytes. */
import { readFile } from "node:fs/promises";
import { loadProvider } from "./lib/provider-loader.mjs";
import { runVenuePhotoBatch } from "./lib/venue-photo-batch.mjs";
import {
  discoverCatalogueSources,
  readCatalogueSource,
} from "./lib/catalogue-sources.mjs";

const options = {};
const allowed = new Set([
  "input",
  "output",
  "ledger",
  "limit",
  "max-searches",
  "monthly-cap",
  "timeout-ms",
  "refresh",
  "help",
]);
for (const value of process.argv.slice(2)) {
  const match = /^--([a-z-]+)(?:=(.*))?$/.exec(value);
  if (!match || !allowed.has(match[1]))
    throw new Error(`Unknown argument: ${value}`);
  options[match[1]] = match[2] ?? "true";
}
if (options.help === "true") {
  console.log(`Prepare official venue photo metadata offline; no image downloads.
Usage: node scripts/prepare-venue-photos.mjs [--input=normalized-places.json]
  --output=src/providers/data/venue-photo-previews.json
  --ledger=src/providers/data/venue-photo-search-ledger.json
  --limit=100          Maximum venues per run (0–100)
  --max-searches=0     Explicit Tavily attempts this run (requires TAVILY_API_KEY)
  --monthly-cap=1000   Maximum ledger attempts per UTC month (0–1000)
  --timeout-ms=12000   Website HTML deadline (1–12000)
  --refresh=true      Re-read website metadata; never bypasses 30-day search cache
Default input combines PLACES and all prepared regional/national OSM sources
(.json or .json.gz). Searches use
Tavily basic (one credit each); all attempts, including failures, consume the
local monthly budget. The lock files prevent concurrent local jobs. Keep the
ledger between runs and use one ledger for every job sharing the API key.`);
} else {
  if (
    options.refresh !== undefined &&
    !["true", "false"].includes(options.refresh)
  )
    throw new Error("Invalid --refresh: expected true or false");
  const { placePhotoQuery, photoVenueIdentity } = loadProvider(
    "src/providers/photo-query.ts",
  );
  const { resolveOfficialWebsitePreview, safeOfficialPhotoUrl } = loadProvider(
    "src/providers/official-photo.ts",
  );
  const { searchOfficialWebsite, websiteDiscoveryIdentity } = loadProvider(
    "src/providers/official-website-discovery.ts",
  );
  const { approvedPhoto } = loadProvider("src/providers/photo-policy.ts");
  let places;
  if (options.input) {
    const input = JSON.parse(await readFile(options.input, "utf8"));
    places = Array.isArray(input) ? input : input.places;
  } else {
    const { PLACES } = loadProvider("src/providers/places.ts");
    const { normalizeOsmElement } = loadProvider(
      "src/providers/nearby-places.ts",
    );
    places = [...PLACES];
    for (const file of await discoverCatalogueSources(process.cwd())) {
      const snapshot = await readCatalogueSource(process.cwd(), file);
      places = places.concat(
        snapshot.elements.map(normalizeOsmElement).filter(Boolean),
      );
    }
  }
  const report = await runVenuePhotoBatch(
    {
      places,
      output: options.output,
      ledger: options.ledger,
      limit: options.limit,
      maxSearches: options["max-searches"],
      monthlyCap: options["monthly-cap"],
      timeoutMs: options["timeout-ms"],
      refresh: options.refresh === "true",
      searchEnabled: Boolean(process.env.TAVILY_API_KEY?.trim()),
    },
    {
      placePhotoQuery,
      photoVenueIdentity,
      websiteDiscoveryIdentity,
      resolveOfficialWebsitePreview,
      safeOfficialPhotoUrl,
      searchOfficialWebsite,
      approvedPhoto,
      onOutcome: (outcome) => console.log(JSON.stringify(outcome)),
    },
  );
  console.log(JSON.stringify(report));
}
