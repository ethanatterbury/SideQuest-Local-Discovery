/** Explicit national preparation; a failed gate never replaces the regional source. */
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { englandCoverage } from "./lib/england-coverage.mjs";
const work = "work/england";
await mkdir(work, { recursive: true });
const run = spawnSync(
  process.env.PYTHON || "python",
  [
    "scripts/import-osm-extract.py",
    "--regions",
    "england",
    "--max-download-mb",
    "2048",
    "--location-storage",
    "sparse_file_array," + work + "/locations.cache",
    "--work-dir",
    work,
    "--output",
    work + "/source.json",
  ],
  { stdio: "inherit" },
);
await rm(work + "/locations.cache", { force: true });
if (run.status !== 0)
  throw Error("England import failed; existing regional catalogue retained.");
const data = JSON.parse(await readFile(work + "/source.json", "utf8")),
  report = englandCoverage(data);
await writeFile(
  work + "/coverage.json",
  JSON.stringify(report, null, 2) + "\n",
);
if (!report.ready)
  throw Error(
    "England coverage gate failed; inspect work/england/coverage.json. Existing regional catalogue retained.",
  );
const audited = spawnSync(
  process.execPath,
  ["scripts/audit-catalog.mjs", work + "/source.json"],
  { stdio: "inherit" },
);
if (audited.status !== 0)
  throw Error("England audit failed; existing regional catalogue retained.");
const audit = JSON.parse(await readFile(work + "/catalog-audit.json", "utf8"));
if (!audit.coverage?.ready || audit.normalizedPlaces < 10000)
  throw Error(
    "England normalized coverage audit failed; existing regional catalogue retained.",
  );

// Track only compact ODbL venue metadata. Image bytes and the national PBF stay
// outside Git; the normal application build prepares cells from this source.
const compressed = await promisify(gzip)(JSON.stringify(data), { level: 9 });
if (compressed.length > 50 * 1024 * 1024)
  throw Error(
    "England metadata exceeds the 50 MiB publication quota; existing catalogue retained.",
  );
await mkdir("src/providers/data/regions", { recursive: true });
const destination = "src/providers/data/regions/england.json.gz";
await writeFile(destination + ".partial", compressed);
await rename(destination + ".partial", destination);
console.log(
  JSON.stringify({
    ...report,
    normalizedPlaces: audit.normalizedPlaces,
    compressedBytes: compressed.length,
    destination,
  }),
);
