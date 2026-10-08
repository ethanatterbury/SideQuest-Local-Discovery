import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getNearbyPlaces,
  getLivePlace,
  normalizeOsmElement,
  normalizeOsmResponse,
  safeWebsite,
  selectNearbyPlaces,
} from "@/providers/nearby-places";
import { GET } from "@/app/api/places/route";
const element = (
  tags: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) => ({
  type: "node",
  id: 123,
  lat: 51.5,
  lon: -0.1,
  tags: { name: "Test venue", leisure: "indoor_play", ...tags },
  ...extra,
});
afterEach(() => vi.unstubAllGlobals());
describe("OSM place normalization", () => {
  it("rejects malformed coordinates, IDs and missing names", () => {
    for (const extra of [
      { lat: NaN },
      { lat: 91 },
      { lon: 181 },
      { lat: "51" },
      { id: -1 },
      { type: "area" },
      { tags: { leisure: "park" } },
    ])
      expect(normalizeOsmElement(element({}, extra))).toBeNull();
    expect(normalizeOsmElement(element({ access: "private" }))).toBeNull();
    expect(() => normalizeOsmResponse({ elements: "broken" })).toThrow();
  });
  it("accepts way centers and cleans control characters in names", () => {
    expect(
      normalizeOsmElement(
        element(
          { name: "Park\u0000" },
          {
            type: "way",
            lat: undefined,
            lon: undefined,
            center: { lat: 48, lon: 2 },
          },
        ),
      ),
    ).toMatchObject({
      name: "Park",
      id: "osm-way-123",
      coordinates: { lat: 48, lng: 2 },
    });
  });
  it("sanitizes unsafe URLs and preserves OSM attribution", () => {
    for (const website of [
      "javascript:alert(1)",
      "data:text/html,x",
      "https://user:pass@example.org",
      "//example.org",
    ])
      expect(safeWebsite(website)).toBe("");
    const place = normalizeOsmElement(
      element({ website: "javascript:alert(1)" }),
    )!;
    expect(place.website).toBe("https://www.openstreetmap.org/node/123");
    expect(place.notes.join(" ")).toContain("OpenStreetMap contributors");
    expect(safeWebsite("https://example.org")).toBe("https://example.org/");
  });
  it("classifies soft play and only uses explicitly mapped age bounds", () => {
    const place = normalizeOsmElement(
      element({
        min_age: "1",
        max_age: "6",
        opening_hours: "Mo-Fr 09:00-17:00",
      }),
    )!;
    expect(place).toMatchObject({
      environment: "indoor",
      intents: ["kids", "active"],
      company: ["family", "friends"],
      duration: [60, 120],
      ageRange: [1, 6],
      cost: null,
    });
    expect(place.familyFeatures).toContain("Soft play");
    expect(place.hours).toBeUndefined();
    for (const tags of [
      { min_age: "6", max_age: "1" },
      { min_age: "2 years", max_age: "seven" },
    ])
      expect(normalizeOsmElement(element(tags))!.ageRange).toBeUndefined();
  });
  it("preserves one-sided age limits while marking the other bound unknown", () => {
    expect(normalizeOsmElement(element({ min_age: "8" }))).toMatchObject({
      ageRange: [8, 99],
    });
    expect(normalizeOsmElement(element({ max_age: "6" }))).toMatchObject({
      ageRange: [0, 6],
    });
    expect(
      normalizeOsmElement(element({ max_age: "6" }))!.notes.join(" "),
    ).toContain("minimum unknown");
  });
  it("keeps outdoor visits in daylight unless lighting or 24/7 access is mapped", () => {
    expect(
      normalizeOsmElement(element({ leisure: "park" }))!.daylightOnly,
    ).toBe(true);
    expect(
      normalizeOsmElement(element({ leisure: "playground", lit: "yes" }))!
        .daylightOnly,
    ).toBe(false);
    expect(
      normalizeOsmElement(element({ leisure: "park", opening_hours: "24/7" }))!
        .daylightOnly,
    ).toBe(false);
    expect(
      normalizeOsmElement(element({ tourism: "museum", leisure: "" }))!.company,
    ).toContain("family");
  });
  it("reserves category diversity when nearer cafés would fill the result cap", () => {
    const cafes = Array.from({ length: 350 }, (_, i) =>
      normalizeOsmElement(
        element(
          { leisure: "", amenity: "cafe", name: `Café ${i}` },
          { id: i + 1, lat: 51.5 + i / 100000 },
        ),
      )!,
    );
    const play = normalizeOsmElement(
      element({ name: "Distant soft play" }, { id: 999, lat: 51.51 }),
    )!;
    const selected = selectNearbyPlaces(
      [...cafes, play],
      { lat: 51.5, lng: -0.1 },
      10,
    );
    expect(selected).toHaveLength(300);
    expect(selected.some((p) => p.id === play.id)).toBe(true);
  });
  it("deduplicates coincident node/way records while retaining separate branches", () => {
    const places = normalizeOsmResponse({
      elements: [
        element(),
        element({}, { type: "way", id: 456 }),
        element({}, { id: 789, lat: 51.51 }),
      ],
    });
    expect(places).toHaveLength(2);
  });
});
describe("nearby discovery", () => {
  it("validates query coordinates without calling the public service", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    for (const url of [
      "?lat=&lng=0",
      "?lat=91&lng=0",
      "?lat=0&lng=NaN",
      "?lat=0&lng=0&radius=",
    ])
      expect(
        (await GET(new Request(`https://example.org/api/places${url}`))).status,
      ).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await getLivePlace("osm-node-1);out;")).toBeNull();
  });
  it("retries mirror, caches the area and preserves detail identity", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({
          elements: [element({}, { lat: 43, lng: 3, lon: 3, id: 333 })],
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    const first = await getNearbyPlaces({ lat: 43, lng: 3 }, 10);
    expect(first.source).toBe("live");
    expect(first.places).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const second = await getNearbyPlaces({ lat: 43.001, lng: 3.001 }, 10);
    expect(second.source).toBe("cached");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await getLivePlace("osm-node-333")).toEqual(first.places[0]);
  });
  it("falls back honestly when both mirrors fail and does not repeatedly hammer them", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetcher);
    const result = await getNearbyPlaces({ lat: -33, lng: 151 }, 30);
    expect(result).toMatchObject({ places: [], source: "fallback" });
    expect(result.message).toContain("unavailable");
    await getNearbyPlaces({ lat: -33, lng: 151 }, 30);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
