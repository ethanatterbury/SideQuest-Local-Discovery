/** Keep research/import artefacts out of a live-discovery deployment. */
import { readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MiB = 1024 ** 2;
export const PUBLIC_ASSET_BUDGET = 20 * MiB;
async function filesIn(folder) {
  const entries = await readdir(folder, { withFileTypes: true }).catch(
    (error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const file = path.join(folder, entry.name);
        return entry.isDirectory() ? filesIn(file) : [file];
      }),
    )
  ).flat();
}

export async function prepareDeployment(root, { clean = false } = {}) {
  const generatedCatalogue = path.join(root, "public/data/venues");
  if (clean) await rm(generatedCatalogue, { recursive: true, force: true });
  const publicFiles = await filesIn(path.join(root, "public"));
  if (
    publicFiles.some((file) => file.startsWith(generatedCatalogue + path.sep))
  )
    throw new Error(
      "National venue catalogue must not be deployed. Run deployment preparation.",
    );
  const publicBytes = (
    await Promise.all(publicFiles.map(async (file) => (await stat(file)).size))
  ).reduce((sum, size) => sum + size, 0);
  if (publicBytes > PUBLIC_ASSET_BUDGET)
    throw new Error(
      `Public assets exceed the ${PUBLIC_ASSET_BUDGET / MiB} MiB deployment budget.`,
    );
  if (!clean) {
    for (const trace of (await filesIn(path.join(root, ".next/server"))).filter(
      (file) => file.endsWith(".nft.json"),
    )) {
      const data = JSON.parse(await readFile(trace, "utf8"));
      for (const relative of data.files || []) {
        const file = path
          .relative(root, path.resolve(path.dirname(trace), relative))
          .replaceAll(path.sep, "/");
        if (
          /^(?:public\/data\/venues\/|src\/providers\/data\/(?:regions\/|regional-osm\.json$|geograph-venue-matches\.json\.gz$|venue-media-assets\/)|work\/)/.test(
            file,
          )
        )
          throw new Error(
            `Offline import artefact leaked into a server function: ${file}`,
          );
      }
    }
  }
  return {
    publicBytes,
    publicFiles: publicFiles.length,
    bundledNationalVenues: 0,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  console.log(
    JSON.stringify(
      await prepareDeployment(process.cwd(), {
        clean: process.argv.includes("--clean"),
      }),
    ),
  );
