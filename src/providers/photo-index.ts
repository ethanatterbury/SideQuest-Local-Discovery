import generated from "./data/place-photo-index.json";
import type { PhotoQuery, PhotoResult } from "./place-photo";
import { photoIdentity, photoVenueIdentity } from "./photo-query";
import { preparedVenuePhoto } from "./prepared-venue-photos";
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
type IndexedEntry = { entry: PhotoIndexEntry; ordinal: number };
const positives = new Map<string, IndexedEntry>();
const negatives = new Map<string, IndexedEntry>();
photoIndex.entries.forEach((entry, ordinal) => {
  const index = entry.image ? positives : negatives;
  const key = entry.image
    ? photoVenueIdentity(entry.query)
    : photoIdentity(entry.query);
  if (!index.has(key)) index.set(key, { entry, ordinal });
});
export function indexedPhoto(
  query: PhotoQuery,
  entries: PhotoIndexEntry[] = photoIndex.entries,
): PhotoIndexEntry | null {
  let entry: PhotoIndexEntry | undefined;
  if (entries === photoIndex.entries) {
    const image = preparedVenuePhoto(query);
    if (image) return { query, image, checkedAt: image.checkedAt! };
    const positive = positives.get(photoVenueIdentity(query));
    const negative = negatives.get(photoIdentity(query));
    entry =
      positive && (!negative || positive.ordinal < negative.ordinal)
        ? positive.entry
        : negative?.entry;
  } else {
    entry = entries.find((e) =>
      e.image
        ? photoVenueIdentity(e.query) === photoVenueIdentity(query)
        : photoIdentity(e.query) === photoIdentity(query),
    );
  }
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
