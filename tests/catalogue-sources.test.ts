import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const folders: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "catalogue-sources-"));
  folders.push(root);
  await mkdir(join(root, "src/providers/data/regions"), { recursive: true });
  return root;
}
afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("discovers compressed national metadata and avoids importing a stale plain duplicate", async () => {
  const root = await fixture();
  for (const name of [
    "england.json",
    "england.json.gz",
    "wales.json",
    "notes.txt",
    "england.json.partial",
  ])
    await writeFile(join(root, "src/providers/data/regions", name), "");
  const { discoverCatalogueSources } =
    await import("../scripts/lib/catalogue-sources.mjs");
  expect(await discoverCatalogueSources(root)).toEqual([
    "src/providers/data/regional-osm.json",
    "src/providers/data/regions/england.json.gz",
    "src/providers/data/regions/wales.json",
  ]);
});

it("loads equivalent plain and gzip metadata and preserves explicit input selection", async () => {
  const root = await fixture();
  const data = {
    sources: ["OpenStreetMap"],
    elements: [{ id: 123, tags: { name: "National venue" } }],
  };
  await writeFile(join(root, "plain.json"), JSON.stringify(data));
  await writeFile(
    join(root, "national.json.gz"),
    gzipSync(JSON.stringify(data)),
  );
  const { discoverCatalogueSources, readCatalogueSource } =
    await import("../scripts/lib/catalogue-sources.mjs");
  expect(await discoverCatalogueSources(root, ["national.json.gz"])).toEqual([
    "national.json.gz",
  ]);
  expect(await readCatalogueSource(root, "national.json.gz")).toEqual(data);
  expect(await readCatalogueSource(root, "plain.json")).toEqual(data);
});

it("keeps the regional fallback when no national source exists, and rejects corrupt compressed metadata", async () => {
  const root = await fixture();
  await rm(join(root, "src/providers/data/regions"), { recursive: true });
  await writeFile(join(root, "broken.json.gz"), "not gzip");
  const { discoverCatalogueSources, readCatalogueSource } =
    await import("../scripts/lib/catalogue-sources.mjs");
  expect(await discoverCatalogueSources(root)).toEqual([
    "src/providers/data/regional-osm.json",
  ]);
  await expect(readCatalogueSource(root, "broken.json.gz")).rejects.toThrow();
});
