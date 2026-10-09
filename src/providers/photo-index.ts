import generated from "./data/place-photo-index.json";
import type { PhotoQuery, PhotoResult } from "./place-photo";
import { photoIdentity } from "./photo-query";
import { approvedPhoto } from "./photo-policy";
export type PhotoIndexEntry = {
  query: PhotoQuery;
  checkedAt: string;
  retryable?: boolean;
} & Pick<PhotoResult, "image" | "diagnostics">;
// JSON dictionaries infer an optional property for every key used by another row.
// The generator and schema test validate numeric dictionaries; absent keys are omitted.
export const photoIndex = generated as unknown as {
  version: number;
  generatedAt: string | null;
  sample: {
    label: string;
    tested: number;
    matched: number;
    retryable?: number;
    unresolved?: number;
  } | null;
  supplemental?: {
    label: string;
    tested: number;
    matched: number;
    retryable?: number;
  };
  entries: PhotoIndexEntry[];
};
export { placePhotoQuery, photoIdentity } from "./photo-query";
export function indexedPhoto(
  query: PhotoQuery,
  entries: PhotoIndexEntry[] = photoIndex.entries,
): PhotoIndexEntry | null {
  const entry = entries.find(
    (e) => photoIdentity(e.query) === photoIdentity(query),
  );
  if (!entry || entry.retryable) return null;
  const age = Date.now() - Date.parse(entry.checkedAt);
  if (
    !Number.isFinite(age) ||
    age < 0 ||
    age > (entry.image ? 30 * 86400000 : 86400000)
  )
    return null;
  if (entry.image) {
    const image = approvedPhoto(entry.image, entry.checkedAt);
    return image ? { ...entry, image } : null;
  }
  return entry;
}
