import { readFile, mkdir, copyFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

// Reproduce serverless packaging: installed-but-untraced files are unavailable.
const root = process.cwd();
const trace = path.resolve(".next/server/app/api/photo/route.js.nft.json");
const data = JSON.parse(await readFile(trace, "utf8"));
const destination = await mkdtemp(path.join(tmpdir(), "sidequest-runtime-"));
try {
  for (const file of data.files) {
    const source = path.resolve(path.dirname(trace), file);
    const relative = path.relative(root, source);
    if (relative.startsWith(".."))
      throw new Error("Runtime file outside project");
    const target = path.join(destination, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }
  const boot = spawnSync(
    process.execPath,
    [
      "-e",
      `require(${JSON.stringify(path.join(destination, "node_modules/next/dist/server/node-environment.js"))})`,
    ],
    { encoding: "utf8", env: { ...process.env, NODE_ENV: "production" } },
  );
  if (boot.status !== 0)
    throw new Error(`Packaged server runtime failed to boot:\n${boot.stderr}`);
  console.log("Packaged photo API runtime boots using traced files only.");
} finally {
  await rm(destination, { recursive: true, force: true });
}
