import { describe, expect, it } from "vitest";
import { groupAttractionPlaces } from "@/domain/attraction-groups";
import { type Place } from "@/domain/models";
import { normalizeOsmElement } from "@/providers/nearby-places";

const bounds = { south: 51.48, west: -0.12, north: 51.52, east: -0.08 };
function venue(
  id: string,
  category: string,
  extra: Partial<Place> = {},
): Place {
  return {
    ...normalizeOsmElement({
      type: "node",
      id: 123,
      lat: 51.5,
      lon: -0.1,
      tags: { name: "Fixture attraction", tourism: "theme_park" },
    })!,
    id,
    category,
    ...extra,
  };
}

describe("attraction overview grouping", () => {
  it.each(["Theme park", "Zoo"])(
    "groups mapped interiors in a %s outline without changing the original places",
    (category) => {
      const parent = venue("main", category, { bounds });
      const ride = venue("ride", "Amusement ride");
      const play = venue("play", "Playground");
      const local = venue("local", "Local attraction");
      const golf = venue("golf", "Miniature golf");
      const places = [ride, parent, play, local, golf];
      const before = structuredClone(places);
      const result = groupAttractionPlaces(places);
      expect(result.overview).toEqual([parent]);
      expect(result.inside).toEqual([ride, play, local, golf]);
      expect([...result.parentByChild]).toEqual([
        ["ride", "main"],
        ["play", "main"],
        ["local", "main"],
        ["golf", "main"],
      ]);
      expect(places).toEqual(before);
      expect(result.inside[0]).toBe(ride);
      expect(result.overview[0]).toBe(parent);
    },
  );
  it("retains distinct museums, hotels, water parks, independent golf and unrelated nearby facilities", () => {
    const parent = venue("main", "Theme park", {
      bounds,
      website: "https://park.example/",
    });
    const distinct = [
      venue("museum", "Museum"),
      venue("hotel", "Hotel"),
      venue("water", "Water park"),
      venue("independent", "Miniature golf", {
        website: "https://golf.example/",
      }),
      venue("nearby", "Playground", { coordinates: { lat: 51.53, lng: -0.1 } }),
    ];
    expect(groupAttractionPlaces([parent, ...distinct]).overview).toEqual([
      parent,
      ...distinct,
    ]);
  });
  it("uses explicit parent identity without inventing missing outlines", () => {
    const parent = venue("main", "Theme park");
    const child = venue("ride", "Amusement ride", { parentId: "main" });
    const unrelated = venue("play", "Playground");
    expect(groupAttractionPlaces([parent, child, unrelated])).toEqual({
      overview: [parent, unrelated],
      inside: [child],
      parentByChild: new Map([["ride", "main"]]),
    });
    expect(groupAttractionPlaces([parent, unrelated]).overview).toEqual([
      parent,
      unrelated,
    ]);
  });
  it("does not replace a missing explicit parent with a guessed spatial parent", () => {
    const parent = venue("main", "Theme park", { bounds });
    const child = venue("ride", "Amusement ride", { parentId: "elsewhere" });
    expect(groupAttractionPlaces([parent, child]).inside).toEqual([]);
  });
  it("does not group boundary points, partly overlapping child areas or ambiguous overlapping parents", () => {
    const parent = venue("main", "Theme park", { bounds });
    const edge = venue("edge", "Playground", {
      coordinates: { lat: bounds.north, lng: -0.1 },
    });
    const overlap = venue("overlap", "Local attraction", {
      bounds: { ...bounds, north: 51.53 },
    });
    expect(groupAttractionPlaces([parent, edge, overlap]).inside).toEqual([]);
    const second = venue("second", "Zoo", { bounds });
    expect(
      groupAttractionPlaces([parent, second, venue("ride", "Amusement ride")])
        .inside,
    ).toEqual([]);
  });
  it("does not use malformed or disconnected cached bounds", () => {
    for (const invalid of [
      { ...bounds, north: NaN },
      { ...bounds, south: 51.51 },
      { ...bounds, west: -181 },
    ]) {
      const parent = venue("main", "Theme park", { bounds: invalid });
      expect(
        groupAttractionPlaces([parent, venue("ride", "Amusement ride")]).inside,
      ).toEqual([]);
    }
  });
});
