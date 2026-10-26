/** Explicit national preparation; a failed gate never replaces the regional source. */
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
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
await mkdir("src/providers/data/regions", { recursive: true });
await writeFile(
  "src/providers/data/regions/england.json.partial",
  JSON.stringify(data),
);
await rename(
  "src/providers/data/regions/england.json.partial",
  "src/providers/data/regions/england.json",
);
const media = spawnSync(
  process.execPath,
  ["scripts/materialize-venue-media.mjs"],
  { stdio: "inherit" },
);
if (media.status !== 0)
  throw Error("Photo materialization failed; do not publish this build.");
const prepared = spawnSync(
  process.execPath,
  ["scripts/build-venue-cells.mjs"],
  { stdio: "inherit" },
);
if (prepared.status !== 0)
  throw Error("Cell preparation failed; do not publish this build.");
console.log(JSON.stringify(report));
