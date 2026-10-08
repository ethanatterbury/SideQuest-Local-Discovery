import { lookupPlacePhoto, parsePhotoQuery } from "@/providers/place-photo";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const query = parsePhotoQuery(new URL(request.url).searchParams);
  if (!query)
    return Response.json(
      { image: null, source: "unavailable" },
      { status: 400 },
    );
  return Response.json(await lookupPlacePhoto(query), {
    headers: { "Cache-Control": "private, max-age=60" },
  });
}
