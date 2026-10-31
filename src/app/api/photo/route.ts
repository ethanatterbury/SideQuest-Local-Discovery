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
  const work = new AbortController();
  try {
    return await Promise.race([
      resolveRequest(
        request,
        Date.now(),
        AbortSignal.any([request.signal, work.signal]),
      ),
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
    work.abort();
    if (deadline) clearTimeout(deadline);
  }
}
async function resolveRequest(
  request: Request,
  started: number,
  signal: AbortSignal,
) {
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
  const indexed = refresh ? null : indexedPhoto(query);
  const entry =
    query.excludeUrl && indexed?.image?.url === query.excludeUrl
      ? null
      : indexed;
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
  if (stored && stored.url !== query.excludeUrl)
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
  const attempts: PhotoResult[] = [];
  const collect = async (
    task: Promise<PhotoResult | undefined>,
  ): Promise<PhotoResult> => {
    const value = await task.catch(() => ({
      image: null,
      source: "unavailable" as const,
      retryable: true,
    }));
    const result: PhotoResult = {
      ...value,
      source: value?.source ?? "unavailable",
      image: approvedPhoto(value?.image) || null,
    };
    attempts.push(result);
    return result;
  };
  const cached: PhotoResult | undefined = entry
    ? {
        image: approvedPhoto(entry.image) || null,
        source: "cached",
        ...(debug && entry.diagnostics
          ? { diagnostics: { ...entry.diagnostics, cacheHit: true } }
          : {}),
      }
    : undefined;
  let result: PhotoResult;
  if (cached?.image) result = cached;
  else {
    const sources = [
      collect(officialPreview(query, started, signal, debug, refresh)),
    ];
    if (cached) attempts.push(cached);
    else
      sources.push(
        collect(
          lookupPlacePhoto(query, {
            debug,
            refresh,
            signal,
            timeoutMs: Math.max(
              1,
              PHOTO_REQUEST_DEADLINE_MS - (Date.now() - started) - 50,
            ),
          }),
        ),
      );
    // Each source verifies venue identity independently. Return the first real
    // photograph; a logo remains a fallback while an actual photo is available.
    const realPhoto = Promise.any(
      sources.map(async (task) => {
        const value = await task;
        if (!value.image || value.image.preview?.kind === "brand-logo")
          throw Error("No photograph from this source");
        return value;
      }),
    );
    result = await realPhoto.catch(async () => {
      await Promise.all(sources);
      return attempts.find((value) => value.image) ?? attempts.at(-1)!;
    });
  }
  const previewRetryable = attempts.some((value) => value.retryable);
  const officialDiagnostics = attempts.find(
    (value) => value.diagnostics?.officialWebsite,
  )?.diagnostics?.officialWebsite;
  if (debug && officialDiagnostics) {
    result = {
      ...result,
      diagnostics: {
        strategy: null,
        sourcesAttempted: [],
        candidateCount: 0,
        rejected: {},
        requestCount: 0,
        elapsedMs: Date.now() - started,
        ...result.diagnostics,
        officialWebsite: officialDiagnostics,
      },
    };
  }
  if (result.image)
    result = { ...result, image: approvedPhoto(result.image) || null };
  if (!result.image && previewRetryable)
    result = { ...result, retryable: true };
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
  const attempts: NonNullable<
    NonNullable<PhotoResult["diagnostics"]>["officialWebsite"]
  >["attempts"] = [];
  let discoveryStatus: string | undefined;
  const diagnostics = () =>
    debug
      ? {
          diagnostics: {
            strategy: null,
            sourcesAttempted: attempts.map((attempt) => attempt.website),
            candidateCount: 0,
            rejected: {},
            requestCount: 0,
            elapsedMs: Date.now() - started,
            officialWebsite: {
              discoveryStatus,
              attempts,
              elapsedMs: Date.now() - previewStarted,
            },
          },
        }
      : {};
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
      discoveryStatus = discovery.status;
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
        {
          signal: controller.signal,
          timeoutMs: remaining,
          refresh,
          excludeUrl: query.excludeUrl,
        },
      );
      attempts.push({
        website,
        reason: preview.result.reason,
        candidateCount: preview.result.candidates.length,
        rejected: preview.result.rejected,
      });
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
                  officialWebsite: {
                    discoveryStatus,
                    attempts,
                    elapsedMs: Date.now() - previewStarted,
                  },
                },
              }
            : {}),
        };
    }
    return {
      image: null,
      source: "unavailable",
      ...(retryable ? { retryable: true } : {}),
      ...diagnostics(),
    };
  } catch {
    return {
      image: null,
      source: "unavailable",
      retryable: true,
      ...diagnostics(),
    };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
