import { expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

it("preserves a verified photo when a paced concurrent refresh fails, without overrunning the batch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sidequest-photo-refresh-"));
  try {
    const input = join(dir, "sample.json");
    const output = join(dir, "index.json");
    const preload = join(dir, "upstream.mjs");
    const query = { id: "verified", name: "Test park", lat: 51.3, lng: -0.8 };
    const image = {
      url: "https://upload.wikimedia.org/verified.jpg",
      source: "https://commons.wikimedia.org/verified",
      credit: "Photographer",
      license: "CC0",
    };
    const checkedAt = "2026-10-07T10:00:00Z";
    await writeFile(
      input,
      JSON.stringify([
        {
          id: query.id,
          name: query.name,
          coordinates: { lat: query.lat, lng: query.lng },
        },
      ]),
    );
    await writeFile(
      output,
      JSON.stringify({ version: 2, entries: [{ query, checkedAt, image }] }),
    );
    await writeFile(
      preload,
      "globalThis.fetch = async () => new Response('Service unavailable', {status: 503});\n",
    );
    await promisify(execFile)(process.execPath, [
      "--import",
      preload,
      "scripts/enrich-place-photos.mjs",
      `--input=${input}`,
      `--output=${output}`,
      "--refresh=true",
      "--batch=1",
      "--concurrency=3",
      "--delay=1",
    ]);
    const index = JSON.parse(await readFile(output, "utf8"));
    expect(index.entries[0].image).toEqual(image);
    expect(index.entries[0].checkedAt).toBe(checkedAt);
    expect(index.entries[0].refreshFailure.diagnostics.rejected).toEqual({
      "HTTP 503": 1,
    });
    expect(index.sample.matched).toBe(1);
    expect(index.sample.retryable).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
