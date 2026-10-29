import generated from "./data/venue-photo-previews.json";
import type { PhotoQuery, PlacePhoto } from "./place-photo";
import { approvedPhoto } from "./photo-policy";

export type PreparedWebsite = {
  urls: string[];
  status: "found" | "no-match" | "unavailable" | "disabled";
  source: "mapped" | "tavily" | "none";
  searchedAt?: string;
  searchExpiresAt?: string;
};
export type PreparedVenuePhotoEntry = {
  query: PhotoQuery;
  checkedAt: string;
  website: PreparedWebsite;
  image: PlacePhoto | null;
  retryable?: boolean;
  status?: string;
  /** Last passing real browser decode and attribution check for this image. */
  deliveryVerifiedAt?: string;
  deliveryFailure?: {
    checkedAt: string;
    imageUrl: string;
    testStatus: string;
    reason: string;
    elapsedMs: number;
    failures: { url: string; error: string | null }[];
  };
};
export const preparedVenuePhotos = generated as {
  version: number;
  generatedAt: string | null;
  entries: PreparedVenuePhotoEntry[];
};
const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[&+]/g, "and")
    .replace(/[^\p{L}\p{N}]/gu, "");
/** Stable across source/address enrichment; still distinct for another identity, name or location. */
export function websiteDiscoveryIdentity(
  query: Pick<PhotoQuery, "id" | "name" | "lat" | "lng">,
): string {
  return JSON.stringify([
    query.id || null,
    normalize(query.name),
    query.lat.toFixed(4),
    query.lng.toFixed(4),
  ]);
}
const byIdentity = new Map(
  preparedVenuePhotos.entries.map((entry) => [
    websiteDiscoveryIdentity(entry.query),
    entry,
  ]),
);
function entryFor(query: PhotoQuery, entries?: PreparedVenuePhotoEntry[]) {
  const key = websiteDiscoveryIdentity(query);
  return entries
    ? entries.find((entry) => websiteDiscoveryIdentity(entry.query) === key)
    : byIdentity.get(key);
}
function fresh(value: string, ttl: number, now: number) {
  const age = now - Date.parse(value);
  return Number.isFinite(age) && age >= 0 && age < ttl;
}
function websiteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.hostname.includes(".") &&
      !/^[\d.]+$/.test(url.hostname) &&
      !url.hostname.includes(":") &&
      !/(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(
        url.hostname,
      )
    );
  } catch {
    return false;
  }
}
/** Read-only durable metadata: no search client or network dependency. */
export function preparedWebsiteCandidates(
  query: PhotoQuery,
  entries?: PreparedVenuePhotoEntry[],
  now = Date.now(),
): { urls: string[]; status: "found" | "no-match" } | undefined {
  const entry = entryFor(query, entries);
  if (!entry || !fresh(entry.checkedAt, 180 * 86400000, now)) return;
  const website = entry.website;
  if (!website || !["found", "no-match"].includes(website.status)) return;
  if (
    website.source === "tavily" &&
    (!website.searchedAt ||
      !fresh(website.searchedAt, 180 * 86400000, now) ||
      !website.searchExpiresAt ||
      !Number.isFinite(Date.parse(website.searchExpiresAt)) ||
      Date.parse(website.searchExpiresAt) <= now)
  )
    return;
  const urls = website.urls.filter(websiteUrl).slice(0, 3);
  if (website.status === "found" && !urls.length) return;
  return { urls, status: website.status as "found" | "no-match" };
}
/** Prepared positives render with the catalogue; unresolved records never become photographs. */
export function preparedVenuePhoto(
  query: PhotoQuery,
  entries?: PreparedVenuePhotoEntry[],
  now = Date.now(),
): PlacePhoto | undefined {
  const entry = entryFor(query, entries);
  if (
    !entry?.image ||
    entry.retryable ||
    !fresh(entry.checkedAt, 180 * 86400000, now)
  )
    return;
  return approvedPhoto(entry.image, entry.checkedAt);
}
