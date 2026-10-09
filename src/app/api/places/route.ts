import { getNearbyPlaces } from "@/providers/nearby-places";
import { withStoredPhoto } from "@/providers/venue-media";
export const maxDuration = 10;
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const lat = params.get("lat"),
    lng = params.get("lng"),
    radius = params.get("radius");
  if (!lat?.trim() || !lng?.trim() || (radius !== null && !radius.trim()))
    return Response.json(
      { error: "Latitude and longitude are required." },
      { status: 400 },
    );
  const coords = { lat: Number(lat), lng: Number(lng) };
  const radiusKm = radius === null ? 25 : Number(radius);
  if (
    !Number.isFinite(coords.lat) ||
    Math.abs(coords.lat) > 90 ||
    !Number.isFinite(coords.lng) ||
    Math.abs(coords.lng) > 180 ||
    !Number.isFinite(radiusKm)
  )
    return Response.json(
      { error: "Invalid coordinates or radius." },
      { status: 400 },
    );
  // Canonical area centers/radii share cache entries without sharing preferences.
  const canonical = { lat: Math.round(coords.lat * 50) / 50, lng: Math.round(coords.lng * 50) / 50 };
  const result = await getNearbyPlaces(canonical, Math.ceil(Math.min(100, Math.max(3, radiusKm)) / 5) * 5, params.get("refresh") !== "1");
  return Response.json(
    { ...result, places: result.places.map(withStoredPhoto) },
    {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=1800, stale-while-revalidate=86400" },
    },
  );
}
