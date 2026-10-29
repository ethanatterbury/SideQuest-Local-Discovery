import { afterEach, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async () => {
    throw new Error("No bundled catalogue available");
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});

it.each([
  ["Manchester", 53.48, -2.24],
  ["Newcastle", 54.98, -1.61],
  ["Bristol", 51.45, -2.59],
  ["Exeter", 50.72, -3.53],
  ["Birmingham", 52.48, -1.9],
  ["Edinburgh", 55.95, -3.19],
  ["Cardiff", 51.48, -3.18],
  ["Belfast", 54.6, -5.93],
])(
  "discovers live places in %s with no national catalogue files",
  async (name, lat, lng) => {
    vi.stubEnv("GEOAPIFY_API_KEY", "server-only-test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {
                name: `${name} Play Centre`,
                lat,
                lon: lng,
                country_code: "gb",
                datasource: {
                  sourcename: "openstreetmap",
                  raw: {
                    osm_type: "n",
                    osm_id: 123456789,
                    leisure: "indoor_play",
                  },
                },
              },
            },
          ],
        }),
      ),
    );
    const { getDiscoveryPlaces } = await import("@/providers/geoapify-places");
    const result = await getDiscoveryPlaces(
      { lat: Number(lat), lng: Number(lng) },
      5,
    );
    expect(result.source).toBe("live");
    expect(
      result.places.some((place) => place.name === `${name} Play Centre`),
    ).toBe(true);
    expect(readFile).not.toHaveBeenCalled();
  },
);
