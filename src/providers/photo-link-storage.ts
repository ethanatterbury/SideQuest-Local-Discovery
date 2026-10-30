import type { PhotoQuery, PlacePhoto } from "./place-photo";
import { approvedPhoto } from "./photo-policy";

const KEY = "sidequest:photo-links:v1";
const TTL = 30 * 86400000;
type Record = { key: string; savedAt: number; image: PlacePhoto };
const identity = (q: PhotoQuery) =>
  JSON.stringify([q.id, q.name.toLowerCase().trim(), q.lat, q.lng]);
function records(): Record[] {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(data)
      ? data
          .filter(
            (r) =>
              r &&
              typeof r.key === "string" &&
              Number.isFinite(r.savedAt) &&
              Date.now() - r.savedAt >= 0 &&
              Date.now() - r.savedAt < TTL &&
              approvedPhoto(r.image),
          )
          .slice(0, 100)
      : [];
  } catch {
    return [];
  }
}
/** Browser-only URL, credit and rights metadata. No image bytes or Vercel storage. */
export function storedPhotoLink(query: PhotoQuery): PlacePhoto | null {
  return records().find((r) => r.key === identity(query))?.image || null;
}
export function savePhotoLink(query: PhotoQuery, image: PlacePhoto): void {
  const approved = approvedPhoto(image);
  if (!approved) return;
  try {
    const key = identity(query);
    const data = [
      { key, savedAt: Date.now(), image: approved },
      ...records().filter((r) => r.key !== key),
    ].slice(0, 100);
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* Private browsing or full storage must not prevent photographs loading. */
  }
}
export function forgetPhotoLink(query: PhotoQuery, url: string): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify(
        records().filter(
          (r) => r.key !== identity(query) || r.image.url !== url,
        ),
      ),
    );
  } catch {
    /* Optional browser metadata. */
  }
}
