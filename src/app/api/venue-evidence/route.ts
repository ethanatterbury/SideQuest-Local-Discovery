import { getDiscoveryPlace } from "@/providers/geoapify-places";
import { readOfficialWebsite } from "@/providers/official-photo";
import { discoverOfficialWebsite } from "@/providers/official-website-discovery";
import { createVenueEnricher } from "@/providers/venue-enrichment";
export const maxDuration = 20;
const enrich = createVenueEnricher({
  getPlace: (id) => getDiscoveryPlace(id, { refreshDetails: true }),
  discoverWebsite: discoverOfficialWebsite,
  readWebsite: readOfficialWebsite,
});
/** Only a persisted OSM identity is accepted; clients never choose a remote website to fetch. */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^osm-(?:node|way|relation)-[1-9]\d{0,15}$/.test(id))
    return Response.json({ error: "Invalid venue identity." }, { status: 400 });
  const result = await enrich(id);
  return Response.json(result, {
    headers: {
      "Cache-Control":
        result.status === "verified"
          ? "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800"
          : ["unavailable", "disabled"].includes(result.status)
            ? "public, max-age=30, s-maxage=60"
            : "public, max-age=300, s-maxage=3600",
    },
  });
}
