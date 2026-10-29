import { afterEach, expect, it, vi } from "vitest";
import type { Place } from "@/domain/models";

const cell = {
  places: [] as Place[],
  sourceDates: {} as Record<string, string | null>,
};
vi.mock("@/providers/prepared-cell", () => ({
  readPreparedCellJson: async (path: string) =>
    path.endsWith("213_-9.json") ? cell : { places: [] },
}));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) =>
      String(args[0]).endsWith("id-index.json")
        ? JSON.stringify({
            "osm-way-987654321": "213_-9",
            "osm-way-987654322": "213_-9",
          })
        : actual.readFile(...args),
  };
});
afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function fixtures() {
  const nearby = await import("@/providers/nearby-places");
  const canonical = nearby.normalizeOsmElement({
    type: "way",
    id: 987654321,
    lat: 53.48,
    lon: -2.24,
    tags: {
      name: "Riverside Learning Centre",
      tourism: "museum",
      website: "https://current-fixture.test/",
    },
  })!;
  const stale = {
    ...canonical,
    id: "osm-way-987654322",
    name: "Old Regional Venue",
  };
  cell.places = [canonical, stale];
  cell.sourceDates = {
    [canonical.id]: new Date().toISOString(),
    [stale.id]: "2001-01-01T00:00:00Z",
  };
  return { nearby, canonical, stale };
}

it("binds each winning record's own date without adding provenance to public Place objects", async () => {
  const { nearby, canonical, stale } = await fixtures();
  const places = await nearby.snapshotArea(canonical.coordinates, 1);
  expect(places).toEqual([canonical, stale]);
  expect(nearby.snapshotSourceDate(canonical)).toBe(
    cell.sourceDates[canonical.id],
  );
  expect(nearby.snapshotSourceDate(stale)).toBe("2001-01-01T00:00:00Z");
  expect(nearby.snapshotSourceDate({ ...canonical })).toBeUndefined();
  expect(canonical).not.toHaveProperty("sourceAt");
  nearby.rememberLivePlaces([
    { ...canonical, name: "Remembered outdated name" },
  ]);
  expect(await nearby.getSnapshotPlace(canonical.id)).toBe(canonical);
});

it("uses fresh canonical identity for direct and remembered Geoapify detail responses", async () => {
  const { nearby, canonical } = await fixtures();
  vi.stubEnv("GEOAPIFY_API_KEY", "fixture-key");
  const fetcher = vi.fn(async () =>
    Response.json({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            name: "Former Riverside Gym",
            lat: 53.48002,
            lon: -2.24,
            country_code: "gb",
            datasource: {
              sourcename: "openstreetmap",
              raw: {
                osm_type: "w",
                osm_id: 987654321,
                leisure: "sports_centre",
                website: "https://old-fixture.test/",
              },
            },
          },
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const { getDiscoveryPlace } = await import("@/providers/geoapify-places");
  expect(await getDiscoveryPlace(canonical.id)).toMatchObject({
    name: canonical.name,
    coordinates: canonical.coordinates,
    website: canonical.website,
    category: canonical.category,
  });
  nearby.rememberLivePlaces([
    { ...canonical, name: "Remembered outdated name" },
  ]);
  expect((await getDiscoveryPlace(canonical.id))?.name).toBe(canonical.name);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
