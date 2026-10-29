/** Explicit offline photo-link maintenance. Image review stays in RAM; no paid services. */
import { loadProvider } from "./lib/provider-loader.mjs";
import {
  readGeographCandidates,
  runGeographPhotoBatch,
} from "./lib/geograph-photo-batch.mjs";

const allowed = new Set([
  "input",
  "output",
  "limit",
  "max-runtime-ms",
  "timeout-ms",
  "refresh",
  "help",
]);
const options = {};
for (const value of process.argv.slice(2)) {
  const match = /^--([a-z-]+)(?:=(.*))?$/.exec(value);
  if (!match || !allowed.has(match[1]))
    throw new Error(`Unknown argument: ${value}`);
  options[match[1]] = match[2] ?? "true";
}
if (options.help === "true") {
  console.log(`Prepare exact Geograph-to-Commons photo URL metadata offline.
  --input=src/providers/data/geograph-venue-matches.json.gz
  --output=src/providers/data/venue-photo-previews.json
  --limit=100                 Maximum venues (0–1000)
  --max-runtime-ms=1200000    Maximum 20 minutes; checkpoints every venue
  --timeout-ms=6500          Maximum metadata lookup deadline (1–15000)
  --refresh=true             Explicitly repeat negative source checks
No API key, paid search, image storage or client-time lookup is used.
The isolated pinned local CPU model inspects eligible photographs in RAM.
Only source-linked, recent (at most ten years), precise subject-position matches
are eligible. Publication still requires the real browser delivery gate.`);
} else {
  if (
    options.refresh !== undefined &&
    !["true", "false"].includes(options.refresh)
  )
    throw new Error("Invalid --refresh");
  const { approvedPhoto } = loadProvider("src/providers/photo-policy.ts");
  const { websiteDiscoveryIdentity } = loadProvider(
    "src/providers/prepared-venue-photos.ts",
  );
  const { resolveGeographCommonsPhoto } = loadProvider(
    "src/providers/geograph-commons-photo.ts",
  );
  const candidates = await readGeographCandidates(
    options.input || "src/providers/data/geograph-venue-matches.json.gz",
  );
  const { createLocalSceneReviewer, warmLocalPhotoModel } =
    await import("./photo-vision/resolver.mjs");
  await warmLocalPhotoModel({
    allowDownload: true,
    cacheDir: process.env.PHOTO_VISION_CACHE_DIR,
  });
  const report = await runGeographPhotoBatch(
    {
      candidates,
      output: options.output,
      limit: options.limit,
      maxRuntimeMs: options["max-runtime-ms"],
      timeoutMs: options["timeout-ms"],
      refresh: options.refresh === "true",
    },
    {
      approvedPhoto,
      websiteDiscoveryIdentity,
      resolveGeographCommonsPhoto,
      reviewPhotograph: createLocalSceneReviewer(),
      onOutcome: (outcome) => console.log(JSON.stringify(outcome)),
    },
  );
  console.log(JSON.stringify(report));
}
