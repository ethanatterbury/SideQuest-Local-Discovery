import { expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { diversifyRecommendations } from "../src/domain/discovery";
import type { Recommendation } from "../src/domain/models";
import { rankMapPlaces } from "../src/features/map/map-food";
import { DEFAULT_QUERY } from "../src/domain/models";
import { PLACES } from "../src/providers/places";
import { emptyState } from "../src/providers/persistence";
import { unavailableWeather } from "../src/domain/environment";
it("ranks a dense catalogue without a multi-second main-thread stall or dropping venues", () => {
  const venues = Array.from({ length: 1000 }, (_, i) => ({
    ...PLACES[0],
    id: `dense-${i}`,
    name: `Dense Museum ${i}`,
    category: "Museum",
    environment: "indoor" as const,
    daylightOnly: false,
    cost: 0,
    coordinates: { lat: 51.347, lng: -0.8 },
    duration: [20, 40] as [number, number],
    hours: [{ days: [0, 1, 2, 3, 4, 5, 6], open: 0, close: 1440 }],
  }));
  const env = {
    location: { name: "Test", lat: 51.347, lng: -0.8 },
    now: "2026-10-30T12:00:00Z",
    weather: unavailableWeather("2026-10-30T12:00:00Z"),
    reducedMotion: true,
    failures: [],
  };
  const start = performance.now();
  const result = rankMapPlaces(venues, DEFAULT_QUERY, env, emptyState());
  expect(result).toHaveLength(1000);
  expect(new Set(result.map((item) => item.place.id)).size).toBe(1000);
  expect(performance.now() - start).toBeLessThan(1500);
}, 20000);

it("preserves the deployed ordering across relevance groups, scores and category penalties", () => {
  const categories = ["Museum", "Cinema", "Park", "Soft play", "Cafe", "Zoo"];
  const rows = Array.from(
    { length: 36 },
    (_, i) =>
      ({
        place: {
          ...PLACES[0],
          id: `order-${i}`,
          name: `Place ${i}`,
          category: categories[i % 6],
        },
        score: 92 - ((i * 7) % 31),
        components: { intent: i % 4 === 0 ? 36 : 10 },
        travel: 5,
        km: 0,
        explanation: "",
        opening: { status: "unknown", label: "Check opening times" },
        reasons: [],
      }) as Recommendation,
  );
  const result = diversifyRecommendations(rows, DEFAULT_QUERY);
  expect(
    createHash("sha256")
      .update(JSON.stringify(result.map((r) => r.place.id)))
      .digest("hex"),
  ).toBe("3dbb46afcfe5a0ada6a35857b2fe2364814bcc425fbeb9c4414838f9057bd685");
});
