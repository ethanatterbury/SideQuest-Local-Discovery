import { expect, it, vi } from "vitest";
import { PLACES } from "@/providers/places";
import { getDiscoveryPlace } from "@/providers/geoapify-places";
import { readOfficialWebsite } from "@/providers/official-photo";
import { GET } from "@/app/api/venue-evidence/route";
vi.mock("@/providers/geoapify-places", () => ({ getDiscoveryPlace: vi.fn() }));
vi.mock("@/providers/official-website-discovery", () => ({
  discoverOfficialWebsite: vi.fn(async () => ({
    status: "disabled",
    urls: [],
  })),
}));
vi.mock("@/providers/official-photo", async (load) => ({
  ...(await load<typeof import("@/providers/official-photo")>()),
  readOfficialWebsite: vi.fn(),
}));
it("rejects arbitrary identities before lookup and never accepts caller-supplied website URLs", async () => {
  const invalid = await GET(
    new Request(
      "https://sidequest.test/api/venue-evidence?id=https://attacker.test/",
    ),
  );
  expect(invalid.status).toBe(400);
  expect(getDiscoveryPlace).not.toHaveBeenCalled();
  vi.mocked(getDiscoveryPlace).mockResolvedValue({
    ...PLACES[0],
    id: "osm-way-501",
    name: "Acorn & Oak",
    category: "Café",
    optionalCategory: "food",
    postcode: "GU7 1AA",
    website: "https://acorn-oak.co.uk/",
    experiences: undefined,
    suitability: undefined,
    ageRange: undefined,
  });
  vi.mocked(readOfficialWebsite).mockResolvedValue({
    html: "<title>Acorn &amp; Oak</title><address>GU7 1AA</address><p>Our dedicated indoor role play village welcomes children. Book a play session for your child.</p>",
    pageUrl: "https://acorn-oak.co.uk/",
    requestCount: 1,
  });
  const response = await GET(
    new Request(
      "https://sidequest.test/api/venue-evidence?id=osm-way-501&website=https://attacker.test/",
    ),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    status: "verified",
    place: { id: "osm-way-501", category: "Play café" },
  });
  expect(getDiscoveryPlace).toHaveBeenCalledWith("osm-way-501", {
    refreshDetails: true,
  });
  expect(vi.mocked(readOfficialWebsite).mock.calls.map(([url]) => url)).toEqual(
    ["https://acorn-oak.co.uk/"],
  );
  expect(response.headers.get("cache-control")).toContain("s-maxage=86400");
});
