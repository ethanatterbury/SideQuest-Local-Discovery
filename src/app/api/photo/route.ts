import {
  lookupPlacePhoto,
  parsePhotoQuery,
  type PhotoResult,
} from "@/providers/place-photo";
import { indexedPhoto } from "@/providers/photo-index";
import { getLivePlace } from "@/providers/nearby-places";
import { storedVenueImage } from "@/providers/venue-media";
import { resolveOfficialPhotos } from "@/providers/official-photo";
import { PLACES } from "@/providers/places";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function GET(request: Request) {
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
  const venue = query.id
    ? PLACES.find((place) => place.id === query.id) ||
      (await getLivePlace(query.id))
    : null;
  const matchingVenue =
    venue &&
    venue.name === query.name &&
    Math.abs(venue.coordinates.lat - query.lat) < 0.0001 &&
    Math.abs(venue.coordinates.lng - query.lng) < 0.0001
      ? venue
      : null;
  const stored = !refresh && matchingVenue && storedVenueImage(matchingVenue);
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
  // Source URLs come from the venue catalogue, never an arbitrary client URL.
  if (
    matchingVenue &&
    !/openstreetmap\.org/.test(matchingVenue.website) &&
    (!entry?.image || refresh)
  ) {
    const official = await resolveOfficialPhotos(
      { ...query, website: matchingVenue.website },
      { timeoutMs: 6500, maxCandidates: 3 },
    );
    if (official.candidates.length)
      return Response.json(
        {
          image: official.candidates[0],
          source: "live",
          ...(debug
            ? {
                diagnostics: {
                  strategy: "official-website",
                  sourcesAttempted: [matchingVenue.website],
                  candidateCount: official.candidates.length,
                  rejected: official.rejected,
                  requestCount: official.requestCount,
                  elapsedMs: official.elapsedMs,
                },
              }
            : {}),
        },
        {
          headers: {
            "Cache-Control":
              "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
          },
        },
      );
  }
  const result: PhotoResult = entry
    ? {
        image: entry.image,
        source: "cached",
        ...(debug && entry.diagnostics
          ? { diagnostics: { ...entry.diagnostics, cacheHit: true } }
          : {}),
      }
    : await lookupPlacePhoto(query, { debug, refresh });
  return Response.json(result, {
    headers: {
      "Cache-Control":
        debug || result.retryable
          ? "private, no-store"
          : `public, max-age=60, s-maxage=${result.image ? 86400 : 300}, stale-while-revalidate=3600`,
    },
  });
}
