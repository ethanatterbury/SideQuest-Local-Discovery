import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const element = (name: string) => ({
  type: "way",
  id: 987654321,
  lat: 53.48,
  lon: -2.24,
  tags: { name, tourism: "museum", website: "https://current-fixture.co.uk/" },
});

it("refreshes an individually requested place from live OSM and retains its stable identity", async () => {
  const nearby = await import("@/providers/nearby-places");
  nearby.rememberLivePlaces([
    nearby.normalizeOsmElement(element("Former Riverside Gym"))!,
  ]);
  const fetcher = vi.fn(async () =>
    Response.json({ elements: [element("Riverside Learning Centre")] }),
  );
  vi.stubGlobal("fetch", fetcher);
  const current = await nearby.getLivePlace("osm-way-987654321", true);
  expect(current).toMatchObject({
    id: "osm-way-987654321",
    name: "Riverside Learning Centre",
    category: "Museum",
  });
  expect(current).not.toHaveProperty("sourceAt");
  expect(await nearby.getLivePlace("osm-way-987654321")).toEqual(current);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("uses a current live identity for an official-evidence refresh instead of a remembered old provider name", async () => {
  const nearby = await import("@/providers/nearby-places");
  nearby.rememberLivePlaces([
    nearby.normalizeOsmElement(element("Former Riverside Gym"))!,
  ]);
  vi.stubEnv("GEOAPIFY_API_KEY", "fixture-key");
  const fetcher = vi.fn(async () =>
    Response.json({ elements: [element("Riverside Learning Centre")] }),
  );
  vi.stubGlobal("fetch", fetcher);
  const { getDiscoveryPlace } = await import("@/providers/geoapify-places");
  expect(
    await getDiscoveryPlace("osm-way-987654321", { refreshDetails: true }),
  ).toMatchObject({
    name: "Riverside Learning Centre",
    website: "https://current-fixture.co.uk/",
    category: "Museum",
  });
  expect((await getDiscoveryPlace("osm-way-987654321"))?.name).toBe(
    "Riverside Learning Centre",
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});
