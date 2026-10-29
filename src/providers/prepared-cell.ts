import { readFile } from "node:fs/promises";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import type { Place } from "@/domain/models";

const decompress = promisify(gunzip);

/** Server bundles carry gzip cells; local older builds can still read JSON. */
export async function readPreparedCellJson(
  file: string,
): Promise<{ places?: Place[] }> {
  let compressed: Buffer;
  try {
    compressed = await readFile(file + ".gz");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return JSON.parse(await readFile(file, "utf8"));
  }
  return JSON.parse((await decompress(compressed)).toString("utf8"));
}
