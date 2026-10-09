import type { PhotoQuery, PlacePhoto } from "./place-photo";

/** Evidence captured from a public Maps place panel, never an image search result. */
export interface MapPhotoRecord {
  id: string;
  name: string;
  lat: number;
  lng: number;
  area?: string;
  title: string;
  url: string;
  website?: string;
  images: (
    | string
    | {
        url: string;
        alt?: string;
        context?: "venue-header";
        /** Only set when this panorama was the visible photo header of this place. */
        placeHeader?: boolean;
      }
  )[];
}
export interface MapPhotoCandidate extends PlacePhoto {
  originalUrl: string;
}
export interface MapPhotoEvidenceResult {
  candidates: MapPhotoCandidate[];
  rejected: Record<string, number>;
  distanceMeters: number | null;
}
type MapPhotoPlace =
  | PhotoQuery
  | {
      id: string;
      name: string;
      coordinates: { lat: number; lng: number };
      category?: string;
      aliases?: string[];
    };

function words(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']s\b/g, "")
    .replace(/centre/g, "center")
    .replace(/\bplay (?:area|ground)\b/g, "playground")
    .replace(/\b(\p{L}{3,})lake\b/gu, "$1 lake")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}
const descriptors = new Set([
  "the",
  "and",
  "by",
  "uk",
  "restaurant",
  "chinese",
  "italian",
  "indian",
  "watersports",
  "resort",
  "trampoline",
  "adventure",
  "mini",
  "minifarm",
  "farm",
  "ltd",
  "limited",
  "nature",
  "reserve",
  "grounds",
  "playground",
  "college",
]);
const generic = new Set([
  "park",
  "playground",
  "play",
  "garden",
  "gardens",
  "museum",
  "center",
  "leisure",
  "sports",
  "swimming",
  "pool",
  "lake",
  "lakes",
  "restaurant",
  "cafe",
  "coffee",
  "bar",
  "pub",
  "gym",
  "cinema",
  "library",
  "nature",
  "reserve",
]);
function nameMatches(
  name: string,
  title: string,
): { matched: boolean; generic: boolean } {
  const target = words(name),
    actual = words(title);
  const distinctive = target.filter((word) => !descriptors.has(word));
  const identity = distinctive.length ? distinctive : target;
  if (!identity.length) return { matched: false, generic: true };
  // Keep Park/Lakes in the identity: Thorpe Park cannot stand in for Thorpe Lakes.
  const matched = identity.every((word) => actual.includes(word));
  return { matched, generic: identity.every((word) => generic.has(word)) };
}
function validCoordinates(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}
function distance(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const radians = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * radians) / 2) ** 2 +
    Math.cos(a.lat * radians) *
      Math.cos(b.lat * radians) *
      Math.sin(((b.lng - a.lng) * radians) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - Math.min(h, 1)));
}
/** Camera-center @ coordinates are not proof of a branch's location. */
export function canonicalMapPlace(
  value: string,
): { url: string; lat: number; lng: number } | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      ![
        "www.google.com",
        "google.com",
        "www.google.co.uk",
        "google.co.uk",
      ].includes(url.hostname) ||
      !/^\/maps\/place\/[^/]+\//.test(url.pathname)
    )
      return null;
    const data = decodeURIComponent(url.pathname);
    const coordinate = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)(?:!|$)/.exec(
      data,
    );
    if (!coordinate) return null;
    const lat = Number(coordinate[1]),
      lng = Number(coordinate[2]);
    if (!validCoordinates(lat, lng)) return null;
    url.search = "";
    url.hash = "";
    return { url: url.href, lat, lng };
  } catch {
    return null;
  }
}

/** Resize only the delivery suffix; the contributor photo's identity stays intact. */
export function normalizeMapPhotoUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !/^lh[3-6]\.googleusercontent\.com$/.test(url.hostname) ||
      url.search ||
      url.hash
    )
      return null;
    const match =
      /^(\/(?:p|gps-cs-s|grass-cs)\/[A-Za-z0-9_-]{10,1500})(?:=w\d+[^/]*)?$/.exec(
        url.pathname,
      );
    if (!match) return null;
    url.pathname = `${match[1]}=w1400-h1000-k-no`;
    return url.href;
  } catch {
    return null;
  }
}
function streetViewUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.hostname !== "streetviewpixels-pa.googleapis.com" ||
      url.pathname !== "/v1/thumbnail" ||
      !/^[A-Za-z0-9_-]{10,200}$/.test(url.searchParams.get("panoid") || "") ||
      url.searchParams.get("cb_client") !== "maps_sv.tactile" ||
      url.searchParams.has("key")
    )
      return null;
    url.searchParams.set("w", "1400");
    url.searchParams.set("h", "1000");
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

export function assessMapPhotoEvidence(
  place: MapPhotoPlace,
  record: MapPhotoRecord,
): MapPhotoEvidenceResult {
  const result: MapPhotoEvidenceResult = {
    candidates: [],
    rejected: {},
    distanceMeters: null,
  };
  const reject = (reason: string) => {
    result.rejected[reason] = (result.rejected[reason] || 0) + 1;
    return result;
  };
  if (
    !record ||
    typeof record.title !== "string" ||
    !Array.isArray(record.images)
  )
    return reject("invalid-record");
  const coordinates = "coordinates" in place ? place.coordinates : place;
  if (
    !validCoordinates(coordinates.lat, coordinates.lng) ||
    !validCoordinates(record.lat, record.lng)
  )
    return reject("invalid-coordinates");
  if (
    (place.id && record.id !== place.id) ||
    record.name !== place.name ||
    distance(coordinates, record) > 25
  )
    return reject("record-place-mismatch");
  const source = canonicalMapPlace(record.url);
  if (!source) return reject("canonical-place-location-required");
  const identities = [place.name, ...(place.aliases || [])].map((name) =>
    nameMatches(name, record.title),
  );
  const identity = identities.find((candidate) => candidate.matched);
  if (!identity) return reject("venue-name-mismatch");
  result.distanceMeters = distance(coordinates, source);
  const nature =
    /\b(?:park|gardens?|nature|reserve|woodland|forest|walk)\b/i.test(
      place.category || "",
    ) &&
    /\b(?:park|gardens?|reserve|wood|forest|lake|lakes)\b/i.test(place.name);
  const radius = identity.generic ? 75 : nature ? 1000 : 300;
  if (result.distanceMeters > radius) return reject("venue-location-mismatch");
  const seen = new Set<string>();
  for (const image of record.images.slice(0, 40)) {
    if (
      !image ||
      (typeof image !== "string" && typeof image.url !== "string")
    ) {
      reject("unsupported-photo-url");
      continue;
    }
    if (
      typeof image !== "string" &&
      /\b(?:logo|avatar|menu|poster|promotion|portrait)\b/i.test(
        image.alt || "",
      )
    ) {
      reject("non-venue-photo");
      continue;
    }
    const originalUrl = typeof image === "string" ? image : image.url;
    const contributorUrl = normalizeMapPhotoUrl(originalUrl);
    const panoramaUrl =
      !contributorUrl &&
      typeof image !== "string" &&
      (image.placeHeader || image.context === "venue-header")
        ? streetViewUrl(originalUrl)
        : null;
    const url = contributorUrl || panoramaUrl;
    if (!url) {
      reject("unsupported-photo-url");
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    result.candidates.push({
      url,
      originalUrl,
      source: source.url,
      credit: contributorUrl
        ? "Google Maps contributors"
        : "Google Maps Street View",
      license: contributorUrl
        ? "Google Maps contributors — rights reserved"
        : "Google Street View — rights reserved",
      confidence: 0.95,
      strategy: "google-maps-place",
      matched: [
        "maps-place-title",
        "maps-place-coordinates",
        ...(panoramaUrl ? ["maps-place-photo-header"] : []),
      ],
    });
  }
  return result;
}

export function getMapPhotoCandidates(
  place: MapPhotoPlace,
  record: MapPhotoRecord,
): MapPhotoCandidate[] {
  return assessMapPhotoEvidence(place, record).candidates;
}
