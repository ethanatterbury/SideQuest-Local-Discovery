import { afterEach, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  open,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  prepareDeployment,
  PUBLIC_ASSET_BUDGET,
} from "../scripts/prepare-deployment.mjs";
import { needsApplicationBuild } from "../scripts/vercel-ignore-build.mjs";

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "sidequest-deployment-"));
  roots.push(root);
  await mkdir(join(root, "public/data/venues"), { recursive: true });
  await mkdir(join(root, "src/providers/data/regions"), { recursive: true });
  await writeFile(
    join(root, "public/data/venues/205_-3.json"),
    '{"places":[]}',
  );
  await writeFile(
    join(root, "src/providers/data/regions/england.json.gz"),
    "research evidence",
  );
  await writeFile(join(root, "public/keep.txt"), "retained");
  return root;
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("removes only generated deployment catalogue files while preserving import evidence and other assets", async () => {
  const root = await fixture();
  await expect(prepareDeployment(root)).rejects.toThrow(
    "National venue catalogue",
  );
  expect(await prepareDeployment(root, { clean: true })).toMatchObject({
    bundledNationalVenues: 0,
  });
  expect(
    await readFile(
      join(root, "src/providers/data/regions/england.json.gz"),
      "utf8",
    ),
  ).toBe("research evidence");
  expect(await readFile(join(root, "public/keep.txt"), "utf8")).toBe(
    "retained",
  );
});

it("blocks excessive static assets and leaked import data in function traces", async () => {
  const root = await fixture();
  await prepareDeployment(root, { clean: true });
  const file = await open(join(root, "public/too-large.bin"), "w");
  await file.truncate(PUBLIC_ASSET_BUDGET + 1);
  await file.close();
  await expect(prepareDeployment(root)).rejects.toThrow("deployment budget");
  await rm(join(root, "public/too-large.bin"));
  await mkdir(join(root, ".next/server"), { recursive: true });
  await writeFile(
    join(root, ".next/server/route.nft.json"),
    JSON.stringify({
      files: ["../../src/providers/data/regions/england.json.gz"],
    }),
  );
  await expect(prepareDeployment(root)).rejects.toThrow(
    "leaked into a server function",
  );
});

it("skips data-only bot commits and deploys actual application, photo-policy and build changes", () => {
  expect(
    needsApplicationBuild([
      "src/providers/data/venue-photo-previews.json",
      ".github/workflows/venue-photos.yml",
    ]),
  ).toBe(false);
  expect(
    needsApplicationBuild(["src/providers/data/regions/england.json.gz"]),
  ).toBe(false);
  for (const file of [
    "src/providers/photo-policy.ts",
    "src/components/map.tsx",
    "package.json",
    "scripts/prepare-deployment.mjs",
    ".vercelignore",
  ])
    expect(needsApplicationBuild([file])).toBe(true);
});
