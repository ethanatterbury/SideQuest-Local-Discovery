import { getNearbyPlaces } from "@/providers/nearby-places";
export const maxDuration = 25;
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
  return Response.json(await getNearbyPlaces(coords, radiusKm), {
    headers: { "Cache-Control": "private, max-age=60" },
  });
}
