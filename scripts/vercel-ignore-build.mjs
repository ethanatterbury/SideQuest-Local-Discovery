/** Vercel exit 0 skips a build; exit 1 builds an application change. */
import { execFileSync } from "node:child_process";

export function needsApplicationBuild(files) {
  return files.some((file) => {
    if (/^(?:docs\/|tests\/|\.github\/)/.test(file) || /\.md$/.test(file))
      return false;
    if (
      /^src\/providers\/data\/(?:regions\/|regional-osm\.json$|geograph-venue-matches\.json\.gz$|venue-photo-(?:previews|search-ledger)\.json$)/.test(
        file,
      )
    )
      return false;
    return /^(?:src\/|public\/|scripts\/|package(?:-lock)?\.json$|next\.config\.|vercel\.json$|\.vercelignore$)/.test(
      file,
    );
  });
}

if (process.argv[1]?.endsWith("vercel-ignore-build.mjs")) {
  let files;
  try {
    const base = process.env.VERCEL_GIT_PREVIOUS_SHA || "HEAD^";
    files = execFileSync("git", ["diff", "--name-only", base, "HEAD"], {
      encoding: "utf8",
    })
      .trim()
      .split("\n");
  } catch {
    console.log("No prior revision available; build the application.");
    process.exit(1);
  }
  const build = needsApplicationBuild(files);
  console.log(
    build
      ? "Application changed; build."
      : "Only maintenance data, documentation or checks changed; skip deployment.",
  );
  process.exit(build ? 1 : 0);
}
