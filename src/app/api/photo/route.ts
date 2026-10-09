import {
  lookupPlacePhoto,
  parsePhotoQuery,
  type PhotoResult,
} from "@/providers/place-photo";
import { indexedPhoto } from "@/providers/photo-index";
import { storedQueryImage, storedVenueImage } from "@/providers/venue-media";
import { PHOTO_DEADLINE_MS, approvedPhoto } from "@/providers/photo-policy";
import { PLACES } from "@/providers/places";
export const runtime = "nodejs";
export const maxDuration = 5;
export async function GET(request: Request) {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      resolveRequest(request, Date.now()),
      new Promise<Response>((resolve) => {
        deadline = setTimeout(
          () =>
            resolve(
              Response.json(
                { image: null, source: "unavailable", retryable: true },
                { headers: { "Cache-Control": "private, no-store" } },
              ),
            ),
          PHOTO_DEADLINE_MS,
        );
      }),
    ]);
  } finally {
    if (deadline) clearTimeout(deadline);
  }
}
async function resolveRequest(request: Request, started: number) {
  const params = new URL(request.url).searchParams;
  const query = parsePhotoQuery(params);
  if (!query)
    return Response.json(
      { image: null, source: "unavailable" },
      { status: 400 },
    );
  const labEnabled =
    process.env.NODE_ENV === "development" ||
    process.env.NEXT_PUBLIC_ENABLE_ENVIRONMENT_LAB === "true";
  // Diagnostics describe public venue/media evidence; cache-bypassing refresh remains private.
  const debug = params.get("debug") === "1";
  const refresh = labEnabled && debug && params.get("refresh") === "1";
  const entry = refresh ? null : indexedPhoto(query);
  const venue = query.id ? PLACES.find((place) => place.id === query.id) : null;
  const matchingVenue =
    venue &&
    venue.name === query.name &&
    Math.abs(venue.coordinates.lat - query.lat) < 0.0001 &&
    Math.abs(venue.coordinates.lng - query.lng) < 0.0001
      ? venue
      : null;
  const stored =
    !refresh &&
    (storedQueryImage(query) ||
      (matchingVenue && storedVenueImage(matchingVenue)));
  if (stored)
    return Response.json(
      {
        image: stored,
        source: "cached",
        ...(debug
          ? {
              diagnostics: {
                strategy: stored.strategy || "stored-venue-photo",
                sourcesAttempted: [stored.source],
                candidateCount: 1,
                rejected: [],
                requestCount: 0,
                elapsedMs: 0,
                cacheHit: true,
              },
            }
          : {}),
      },
      {
        headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" },
      },
    );
  // Website attribution is not permission. Official-site scraping is excluded by
  // default; permissioned prepared assets need explicit evidence and policy opt-in.
  const result: PhotoResult = entry
    ? {
        image: entry.image,
        source: "cached",
        ...(debug && entry.diagnostics
          ? { diagnostics: { ...entry.diagnostics, cacheHit: true } }
          : {}),
      }
    : await lookupPlacePhoto(query, {
        debug,
        refresh,
        timeoutMs: Math.max(1, PHOTO_DEADLINE_MS - (Date.now() - started) - 50),
      });
  if (result.image) result.image = approvedPhoto(result.image) || null;
  return Response.json(result, {
    headers: {
      "Cache-Control":
        debug || result.retryable
          ? "private, no-store"
          : `public, max-age=3600, s-maxage=${result.image ? 86400 : 604800}, stale-while-revalidate=3600`,
    },
  });
}
