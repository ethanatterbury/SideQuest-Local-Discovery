import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getNearbyPlaces,
  normalizeOsmElement,
} from "@/providers/nearby-places";
import { normalizeGeoapifyResponse } from "@/providers/geoapify-places";

const element = (bounds?: unknown) => ({
  type: "way",
  id: 123,
  center: { lat: 51.5, lon: -0.1 },
  bounds,
  tags: { name: "Fixture attraction", tourism: "theme_park" },
});
const bbox = { lon1: -0.12, lat1: 51.48, lon2: -0.08, lat2: 51.52 };
const feature = (box?: unknown) => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        name: "Fixture attraction",
        lat: 51.5,
        lon: -0.1,
        bbox: box,
        datasource: {
          sourcename: "openstreetmap",
          raw: { osm_type: "w", osm_id: 123, tourism: "theme_park" },
        },
      },
    },
  ],
});

afterEach(() => vi.unstubAllGlobals());
describe("mapped attraction bounds", () => {
  it("requests actual tourism extents from Overpass instead of center-only output", async () => {
    let query = "";
    vi.stubGlobal("fetch", async (_url: string, options: RequestInit) => {
      query = new URLSearchParams(String(options.body)).get("data") || "";
      return Response.json({ elements: [] });
    });
    await getNearbyPlaces({ lat: 51.49, lng: -0.13 }, 5, false);
    expect(query).toMatch(/\[tourism[^;]+;out bb tags 500/);
  });
  it("normalizes real Overpass bounds", () => {
    expect(
      normalizeOsmElement(
        element({ minlat: 51.48, minlon: -0.12, maxlat: 51.52, maxlon: -0.08 }),
      )?.bounds,
    ).toEqual({ south: 51.48, west: -0.12, north: 51.52, east: -0.08 });
  });
  it("normalizes Geoapify's bbox property when supplied", () => {
    expect(normalizeGeoapifyResponse(feature(bbox))[0].bounds).toEqual({
      south: 51.48,
      west: -0.12,
      north: 51.52,
      east: -0.08,
    });
  });
  it.each([
    undefined,
    {},
    { minlat: "51.48", minlon: -0.12, maxlat: 51.52, maxlon: -0.08 },
    { minlat: NaN, minlon: -0.12, maxlat: 51.52, maxlon: -0.08 },
    { minlat: 51.48, minlon: -181, maxlat: 51.52, maxlon: -0.08 },
    { minlat: 51.48, minlon: -0.12, maxlat: 91, maxlon: -0.08 },
    { minlat: 51.52, minlon: -0.12, maxlat: 51.48, maxlon: -0.08 },
    { minlat: 51.48, minlon: -0.08, maxlat: 51.52, maxlon: -0.12 },
    { minlat: 51.51, minlon: -0.12, maxlat: 51.52, maxlon: -0.08 },
    { minlat: 51.5, minlon: -0.12, maxlat: 51.5, maxlon: -0.08 },
  ])(
    "does not manufacture bounds from malformed or missing OSM outlines %j",
    (bounds) => {
      expect(normalizeOsmElement(element(bounds))?.bounds).toBeUndefined();
    },
  );
  it.each([
    undefined,
    {},
    { ...bbox, lat1: 52 },
    { ...bbox, lon2: Infinity },
    { ...bbox, lat1: "51.48" },
  ])("leaves unavailable or invalid Geoapify bounds unknown %j", (bounds) => {
    expect(
      normalizeGeoapifyResponse(feature(bounds))[0].bounds,
    ).toBeUndefined();
  });
});
