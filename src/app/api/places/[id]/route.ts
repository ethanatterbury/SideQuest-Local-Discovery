import { getLivePlace } from "@/providers/nearby-places";
export const maxDuration = 25;
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const place = await getLivePlace(id);
  return place
    ? Response.json(place, {
        headers: { "Cache-Control": "public, max-age=1800" },
      })
    : Response.json({ error: "Place not found." }, { status: 404 });
}
