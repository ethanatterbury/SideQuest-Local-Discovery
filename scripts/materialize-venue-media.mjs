import { readdir, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const root = new URL("../", import.meta.url);
const archives = new URL(
  "../src/providers/data/venue-media-assets/",
  import.meta.url,
);
await mkdir(new URL("public/venue-images/", root), { recursive: true });
for (const file of await readdir(archives).catch(() => [])) {
  if (!/^photos-[a-z0-9-]+\.tar\.gz$/.test(file)) continue;
  execFileSync("tar", [
    "-xzf",
    new URL(file, archives).pathname,
    "-C",
    new URL("public/venue-images/", root).pathname,
  ]);
}
const media = JSON.parse(
  await readFile(new URL("src/providers/data/venue-media.json", root), "utf8"),
);
const { loadProvider } = await import("./lib/provider-loader.mjs");
const ids = new Set(
  loadProvider("src/providers/places.ts").PLACES.map((place) => place.id),
);
await writeFile(
  new URL("src/providers/data/seed-venue-media.json", root),
  JSON.stringify({
    entries: media.entries
      .filter((entry) => ids.has(entry.id))
      .map(({ id, image }) => ({ id, image })),
  }) + "\n",
);
