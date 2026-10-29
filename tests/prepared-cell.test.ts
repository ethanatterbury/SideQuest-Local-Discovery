import { afterEach, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const folders: string[] = [];
async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), "prepared-cell-"));
  folders.push(folder);
  return join(folder, "51_-1.json");
}
afterEach(async () => {
  await Promise.all(
    folders
      .splice(0)
      .map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

it("reads compressed server cells even when no plain browser JSON is bundled", async () => {
  const file = await fixture();
  const data = { version: 2, places: [{ id: "compressed-venue" }] };
  await writeFile(file + ".gz", gzipSync(JSON.stringify(data)));
  const { readPreparedCellJson } =
    await import("../src/providers/prepared-cell");
  expect(await readPreparedCellJson(file)).toEqual(data);
});

it("prefers compressed metadata and falls back to plain JSON only when gzip is absent", async () => {
  const file = await fixture();
  const plain = { places: [{ id: "plain" }] };
  const compressed = { places: [{ id: "compressed" }] };
  await writeFile(file, JSON.stringify(plain));
  const { readPreparedCellJson } =
    await import("../src/providers/prepared-cell");
  expect(await readPreparedCellJson(file)).toEqual(plain);
  await writeFile(file + ".gz", gzipSync(JSON.stringify(compressed)));
  expect(await readPreparedCellJson(file)).toEqual(compressed);
});

it("does not hide corrupt compressed metadata behind an older plain file", async () => {
  const file = await fixture();
  await writeFile(file, JSON.stringify({ places: [{ id: "stale" }] }));
  await writeFile(file + ".gz", "corrupt gzip");
  const { readPreparedCellJson } =
    await import("../src/providers/prepared-cell");
  await expect(readPreparedCellJson(file)).rejects.toThrow();
});
