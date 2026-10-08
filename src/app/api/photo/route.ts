import {
  lookupPlacePhoto,
  parsePhotoQuery,
  type PhotoResult,
} from "@/providers/place-photo";
import { indexedPhoto } from "@/providers/photo-index";
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
  const entry = !refresh && indexedPhoto(query);
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
