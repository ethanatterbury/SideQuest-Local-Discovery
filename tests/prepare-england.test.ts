import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const folders: string[] = [];
const script = fileURLToPath(
  new URL("../scripts/prepare-england.mjs", import.meta.url),
);
const audit = new URL("../scripts/audit-catalog.mjs", import.meta.url).href;
const sourceUrl =
  "https://download.geofabrik.de/europe/united-kingdom/england-latest.osm.pbf";
const centers = [
  [54.9783, -1.6178],
  [53.4808, -2.2426],
  [53.959, -1.0815],
  [52.4862, -1.8904],
  [52.63, 1.297],
  [51.5074, -0.1278],
  [50.7184, -3.5339],
  [50.118, -5.537],
];
async function fixture(data: unknown) {
  const root = await mkdtemp(join(tmpdir(), "prepare-england-"));
  folders.push(root);
  await mkdir(join(root, "src/providers/data/regions"), { recursive: true });
  await mkdir(join(root, "scripts"), { recursive: true });
  await writeFile(join(root, "source-fixture.json"), JSON.stringify(data));
  const importer = join(root, "importer.cjs");
  await writeFile(
    importer,
    `#!/usr/bin/env node\nconst fs = require("node:fs"); fs.mkdirSync("work/england", { recursive: true }); fs.copyFileSync("source-fixture.json", "work/england/source.json");\n`,
    { mode: 0o755 },
  );
  await writeFile(
    join(root, "scripts/audit-catalog.mjs"),
    `await import(${JSON.stringify(audit)});\n`,
  );
  const destination = join(root, "src/providers/data/regions/england.json.gz");
  await writeFile(destination, "existing approved catalogue");
  return {
    root,
    destination,
    run: () =>
      promisify(execFile)(process.execPath, [script], {
        cwd: root,
        env: { ...process.env, PYTHON: importer },
      }),
  };
}
afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("preserves the published catalogue when imported metadata fails the England coverage gate", async () => {
  const test = await fixture({ sources: [sourceUrl], elements: [] });
  await expect(test.run()).rejects.toThrow("England coverage gate failed");
  expect(await readFile(test.destination, "utf8")).toBe(
    "existing approved catalogue",
  );
});

it("preserves the published catalogue when named coverage passes but normalization rejects the records", async () => {
  const test = await fixture({
    sources: [sourceUrl],
    elements: Array.from({ length: 10000 }, (_, index) => ({
      type: "node",
      id: index + 1,
      lat: centers[index % centers.length][0],
      lon: centers[index % centers.length][1],
      tags: { name: `Unsupported fixture ${index}`, access: "private" },
    })),
  });
  await expect(test.run()).rejects.toThrow(
    "England normalized coverage audit failed",
  );
  expect(await readFile(test.destination, "utf8")).toBe(
    "existing approved catalogue",
  );
}, 20000);

it("publishes compressed metadata only after the actual normalization audit passes", async () => {
  const data = {
    generatedAt: "2026-10-28T00:00:00Z",
    sources: [sourceUrl],
    copyright: "OpenStreetMap contributors, ODbL 1.0",
    elements: Array.from({ length: 10000 }, (_, index) => ({
      type: "node",
      id: index + 1,
      lat: centers[index % centers.length][0],
      lon: centers[index % centers.length][1],
      tags: { name: `Fixture Museum ${index}`, tourism: "museum" },
    })),
  };
  const test = await fixture(data);
  await test.run();
  expect(
    JSON.parse(gunzipSync(await readFile(test.destination)).toString()),
  ).toEqual(data);
  const report = JSON.parse(
    await readFile(join(test.root, "work/england/catalog-audit.json"), "utf8"),
  );
  expect(report.coverage.ready).toBe(true);
  expect(report.normalizedPlaces).toBe(10000);
  await expect(
    readFile(join(test.root, "src/providers/data/regions/england.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await expect(
    readFile(join(test.root, "public/venue-images")),
  ).rejects.toMatchObject({ code: "ENOENT" });
}, 20000);
