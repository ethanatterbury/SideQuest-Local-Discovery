import { getLivePlace } from "@/providers/nearby-places";
import { withStoredPhoto } from "@/providers/venue-media";
import { PLACES } from "@/providers/places";
export const maxDuration = 25;
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const place =
    PLACES.find((place) => place.id === id) || (await getLivePlace(id));
  return place
    ? Response.json(withStoredPhoto(place), {
        headers: { "Cache-Control": "public, max-age=1800" },
      })
    : Response.json({ error: "Place not found." }, { status: 404 });
}
