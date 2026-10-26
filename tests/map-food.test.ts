import { describe, expect, it } from "vitest";
import { isMapFoodPlace } from "../src/features/map/map-food";

describe("Map food venue classification", () => {
  it.each([
    "Café",
    "Cafés",
    "Coffee shop",
    "Restaurant",
    "Ice-cream shop",
    "Tea room",
    "Pub",
    "Bars",
    "Bakery",
    "Food market",
  ])("recognizes %s as a food venue", (category) => {
    expect(isMapFoodPlace({ category })).toBe(true);
  });
  it.each(["Arts centre & grounds", "Museum", "Gardens & parks", "Soft play"])(
    "preserves %s outings even if food is an incidental intent",
    (category) => {
      expect(isMapFoodPlace({ category, intents: ["food", "culture"] })).toBe(
        false,
      );
    },
  );
});

import { rankMapPlaces } from "../src/features/map/map-food";
import { DEFAULT_QUERY } from "../src/domain/models";
import { PLACES } from "../src/providers/places";
import { emptyState } from "../src/providers/persistence";
import { unavailableWeather } from "../src/domain/environment";
it("includes opted-in coffee alongside a chosen outing while preserving its budget", () => {
  const origin = { name: "Test", lat: 51.347, lng: -0.8 };
  const play = {
    ...PLACES[0],
    id: "play",
    category: "Soft play",
    environment: "indoor" as const,
    daylightOnly: false,
    coordinates: origin,
    duration: [30, 60] as [number, number],
    cost: 0,
  };
  const coffee = {
    ...play,
    id: "coffee",
    name: "Coffee",
    category: "Café",
    intents: ["food" as const],
  };
  const expensive = {
    ...coffee,
    id: "expensive",
    name: "Expensive coffee",
    cost: 250,
  };
  const env = {
    location: origin,
    now: "2026-10-26T12:00:00Z",
    weather: unavailableWeather("2026-10-26T12:00:00Z"),
    reducedMotion: true,
    failures: [],
  };
  const q = { ...DEFAULT_QUERY, activity: "soft-play" as const };
  expect(
    rankMapPlaces([play, coffee, expensive], q, env, emptyState()).map(
      (r) => r.place.id,
    ),
  ).toEqual(["play"]);
  expect(
    rankMapPlaces(
      [play, coffee, expensive],
      { ...q, includeCategories: ["food"] },
      env,
      emptyState(),
    ).map((r) => r.place.id),
  ).toEqual(["play", "coffee"]);
});
