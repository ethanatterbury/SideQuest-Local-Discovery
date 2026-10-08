import generated from "./data/place-photo-index.json";
import type { PhotoQuery, PhotoResult } from "./place-photo";
import type { Place } from "../domain/models";
export type PhotoIndexEntry = {
  query: PhotoQuery;
  checkedAt: string;
  retryable?: boolean;
} & Pick<PhotoResult, "image" | "diagnostics">;
export const photoIndex = generated as {
  version: number;
  generatedAt: string | null;
  sample: {
    label: string;
    tested: number;
    matched: number;
    retryable?: number;
    unresolved?: number;
  } | null;
  entries: PhotoIndexEntry[];
};
export function placePhotoQuery(place: Place): PhotoQuery {
  return {
    id: place.id,
    name: place.name,
    lat: place.coordinates.lat,
    lng: place.coordinates.lng,
    area: place.area,
    category: place.category,
    aliases: place.aliases,
    wikidata: place.wikidata,
    wikipedia: place.wikipedia,
    osmImage: place.osmImage,
    commons: place.commons,
    website: place.website,
  };
}
export function photoIdentity(query: PhotoQuery): string {
  return JSON.stringify([
    query.id,
    query.name.toLowerCase().trim(),
    query.lat,
    query.lng,
    query.wikidata,
    query.wikipedia,
    query.osmImage,
    query.commons,
    query.aliases || [],
  ]);
}
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
  return entry;
}
