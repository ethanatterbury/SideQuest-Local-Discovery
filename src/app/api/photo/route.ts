import {
  lookupPlacePhoto,
  parsePhotoQuery,
  type PhotoResult,
  type PhotoQuery,
} from "@/providers/place-photo";
import { indexedPhoto } from "@/providers/photo-index";
import { storedQueryImage, storedVenueImage } from "@/providers/venue-media";
import {
  PHOTO_REQUEST_DEADLINE_MS,
  approvedPhoto,
} from "@/providers/photo-policy";
import { resolveOfficialWebsitePreview } from "@/providers/official-photo";
import { discoverOfficialWebsite } from "@/providers/official-website-discovery";
import { PLACES } from "@/providers/places";
export const runtime = "nodejs";
export const maxDuration = 10;
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
          PHOTO_REQUEST_DEADLINE_MS,
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
  // Publisher-selected external previews have a separate rights contract from reusable photos.
  // An indexed Commons absence says nothing about a venue's own published link preview.
  let result: PhotoResult | undefined;
  if (!entry?.image)
    result = await officialPreview(
      query,
      started,
      request.signal,
      debug,
      refresh,
    );
  const previewRetryable = result?.retryable;
  if (!result?.image)
    result = entry
      ? {
          image: entry.image,
          source: "cached",
          ...(result?.retryable ? { retryable: true } : {}),
          ...(debug && entry.diagnostics
            ? { diagnostics: { ...entry.diagnostics, cacheHit: true } }
            : {}),
        }
      : await lookupPlacePhoto(query, {
          debug,
          refresh,
          timeoutMs: Math.max(
            1,
            PHOTO_REQUEST_DEADLINE_MS - (Date.now() - started) - 50,
          ),
        });
  if (result.image) result.image = approvedPhoto(result.image) || null;
  if (!result.image && previewRetryable) result.retryable = true;
  return Response.json(result, {
    headers: {
      "Cache-Control":
        debug || result.retryable
          ? "private, no-store"
          : `public, max-age=3600, s-maxage=${result.image ? 86400 : 604800}, stale-while-revalidate=3600`,
    },
  });
}

async function officialPreview(
  query: PhotoQuery,
  started: number,
  signal: AbortSignal,
  debug: boolean,
  refresh: boolean,
): Promise<PhotoResult | undefined> {
  const budget = Math.min(
    4000,
    PHOTO_REQUEST_DEADLINE_MS - (Date.now() - started) - 100,
  );
  if (budget <= 0) return;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, budget);
  const previewStarted = Date.now();
  let retryable = false;
  try {
    let urls: string[] = [];
    try {
      const website = new URL(query.website || "");
      if (
        !/(?:^|\.)(?:openstreetmap\.org|wikipedia\.org|facebook\.com|instagram\.com|google\.com|google\.co\.uk|tripadvisor\.com|yell\.com)$/.test(
          website.hostname,
        )
      )
        urls = [query.website!];
    } catch {
      /* A missing mapped website may be found by optional configured discovery. */
    }
    if (!urls.length) {
      const discovery = await discoverOfficialWebsite(query, {
        signal: controller.signal,
        timeoutMs: Math.min(2200, budget),
      });
      urls = discovery.urls.slice(0, 2);
      retryable = ["unavailable", "disabled"].includes(discovery.status);
    }
    for (const website of urls) {
      const remaining = budget - (Date.now() - previewStarted);
      if (remaining <= 0 || controller.signal.aborted) {
        retryable = true;
        break;
      }
      const preview = await resolveOfficialWebsitePreview(
        { ...query, website },
        { signal: controller.signal, timeoutMs: remaining, refresh },
      );
      retryable ||= preview.retryable;
      const image = approvedPhoto(preview.image);
      if (image)
        return {
          image,
          source: "live",
          ...(debug
            ? {
                diagnostics: {
                  strategy: image.strategy ?? null,
                  sourcesAttempted: [website],
                  candidateCount: preview.result.candidates.length,
                  rejected: preview.result.rejected,
                  requestCount: preview.result.requestCount,
                  elapsedMs: Date.now() - started,
                },
              }
            : {}),
        };
    }
    return {
      image: null,
      source: "unavailable",
      ...(retryable ? { retryable: true } : {}),
    };
  } catch {
    return { image: null, source: "unavailable", retryable: true };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
