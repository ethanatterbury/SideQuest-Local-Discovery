import { describe, expect, it } from "vitest";
import { buildItinerary } from "../src/domain/itinerary";
import {
  DEFAULT_QUERY,
  type Environment,
  type Place,
} from "../src/domain/models";
import { emptyState } from "../src/providers/persistence";

const env: Environment = {
  location: { name: "Home", lat: 51.3, lng: -0.8 },
  now: "2026-10-07T10:00:00Z",
  weather: {
    kind: "sunny",
    temperature: 18,
    rain: 0,
    wind: 5,
    visibility: 10,
    sunrise: "2026-10-07T06:00:00Z",
    sunset: "2026-10-07T17:30:00Z",
    observedAt: "2026-10-07T10:00:00Z",
    source: "simulation",
  },
  reducedMotion: false,
  failures: [],
};
function venue(id: string, overrides: Partial<Place> = {}): Place {
  return {
    id,
    name: id,
    area: "Local",
    coordinates: env.location,
    category: "Museum",
    description: "A visit",
    tagline: "Explore",
    environment: "indoor",
    intents: ["culture"],
    company: ["solo", "couple", "family", "friends"],
    duration: [45, 180],
    cost: 0,
    costLabel: "Free",
    novelty: 0.5,
    daylightOnly: false,
    website: "https://example.com",
    source: "https://example.com",
    notes: [],
    ...overrides,
  };
}
describe("practical day plans", () => {
  it.each([
    {
      travelMode: "drive" as const,
      firstLatitude: 51.38,
      secondLatitude: 51.42,
      travel: 30,
    },
    {
      travelMode: "walk" as const,
      firstLatitude: 51.31,
      secondLatitude: 51.32,
      travel: 30,
    },
  ])(
    "keeps the final $travelMode journey home within the per-leg travel cap",
    ({ travelMode, firstLatitude, secondLatitude, travel }) => {
      const plan = buildItinerary(
        [
          venue("preferred", {
            coordinates: { lat: firstLatitude, lng: -0.8 },
            duration: [60, 60],
            intents: ["culture"],
          }),
          venue("farther", {
            coordinates: { lat: secondLatitude, lng: -0.8 },
            duration: [45, 45],
            intents: ["unusual"],
          }),
        ],
        {
          ...DEFAULT_QUERY,
          intent: "culture",
          minutes: 240,
          travel,
          travelMode,
        },
        env,
        emptyState(),
        { food: false },
      );
      expect(
        plan?.stops.filter((s) => s.type === "place").map((s) => s.placeId),
      ).toEqual(["preferred"]);
    },
  );
  it.each([
    {
      travelMode: "drive" as const,
      firstLatitude: 51.38,
      secondLatitude: 51.4,
    },
    {
      travelMode: "walk" as const,
      firstLatitude: 51.31,
      secondLatitude: 51.315,
    },
  ])(
    "allows a $travelMode return exactly at the 30-minute leg limit",
    ({ travelMode, firstLatitude, secondLatitude }) => {
      const plan = buildItinerary(
        [
          venue("preferred", {
            coordinates: { lat: firstLatitude, lng: -0.8 },
            duration: [60, 60],
            intents: ["culture"],
          }),
          venue("boundary", {
            coordinates: { lat: secondLatitude, lng: -0.8 },
            duration: [45, 45],
            intents: ["unusual"],
          }),
        ],
        {
          ...DEFAULT_QUERY,
          intent: "culture",
          minutes: 240,
          travel: 30,
          travelMode,
        },
        env,
        emptyState(),
        { food: false },
      );
      expect(
        plan?.stops.filter((s) => s.type === "place").map((s) => s.placeId),
      ).toEqual(["preferred", "boundary"]);
      const beforeHome = plan!.stops.at(-2)!;
      expect(
        (Date.parse(plan!.stops.at(-1)!.at) - Date.parse(beforeHome.at)) /
          60000 -
          beforeHome.minutes,
      ).toBe(30);
    },
  );
  it.each([
    { travelMode: "drive" as const, minutes: 140, travel: 30, latitude: 51.33 },
    { travelMode: "walk" as const, minutes: 130, travel: 15, latitude: 51.305 },
  ])(
    "uses the actual homeward leg for a second stop when $travelMode travel is asymmetric",
    ({ travelMode, minutes, travel, latitude }) => {
      const plan = buildItinerary(
        [
          venue("preferred", {
            coordinates: { lat: latitude, lng: -0.8 },
            duration: [60, 60],
            intents: ["culture"],
          }),
          venue("homeward", { duration: [45, 45], intents: ["unusual"] }),
        ],
        { ...DEFAULT_QUERY, intent: "culture", minutes, travel, travelMode },
        env,
        emptyState(),
        { food: false },
      );
      expect(
        plan?.stops.filter((s) => s.type === "place").map((s) => s.placeId),
      ).toEqual(["preferred", "homeward"]);
      expect(plan?.minutes).toBe(minutes);
      expect(plan?.stops.at(-1)?.at).toBe(
        minutes === 140
          ? "2026-10-07T12:20:00.000Z"
          : "2026-10-07T12:10:00.000Z",
      );
    },
  );
  it.each([
    { travelMode: "drive" as const, minutes: 139, travel: 30, latitude: 51.33 },
    { travelMode: "walk" as const, minutes: 129, travel: 15, latitude: 51.305 },
  ])(
    "still rejects a $travelMode continuation when its real homeward leg cannot fit",
    ({ travelMode, minutes, travel, latitude }) => {
      const plan = buildItinerary(
        [
          venue("preferred", {
            coordinates: { lat: latitude, lng: -0.8 },
            duration: [60, 60],
            intents: ["culture"],
          }),
          venue("homeward", { duration: [45, 45], intents: ["unusual"] }),
        ],
        { ...DEFAULT_QUERY, intent: "culture", minutes, travel, travelMode },
        env,
        emptyState(),
        { food: false },
      );
      expect(
        plan?.stops.filter((s) => s.type === "place").map((s) => s.placeId),
      ).toEqual(["preferred"]);
      expect(plan!.minutes).toBeLessThanOrEqual(minutes);
    },
  );
  it("reserves time for a second meaningful stop instead of filling the day with the first", () => {
    const plan = buildItinerary(
      [venue("first"), venue("second", { duration: [30, 60] })],
      DEFAULT_QUERY,
      env,
      emptyState(),
      { food: true },
    );
    expect(plan?.stops.filter((s) => s.type === "place")).toHaveLength(2);
    expect(plan?.stops.some((s) => s.type === "break")).toBe(true);
    expect(plan!.minutes).toBeLessThanOrEqual(180);
  });
  it("considers a second venue that opens after departure but before its actual arrival", () => {
    const plan = buildItinerary(
      [
        venue("first", { duration: [60, 60] }),
        venue("later", {
          duration: [30, 30],
          hours: [{ days: [3], open: 12 * 60, close: 17 * 60 }],
        }),
      ],
      DEFAULT_QUERY,
      env,
      emptyState(),
      { food: false },
    );
    expect(
      plan?.stops.filter((s) => s.type === "place").map((s) => s.placeId),
    ).toEqual(["first", "later"]);
  });
  it("does not invent a food purchase when only a picnic allowance is requested", () => {
    const plan = buildItinerary(
      [venue("first", { duration: [45, 60] })],
      DEFAULT_QUERY,
      env,
      emptyState(),
      { food: true },
    );
    expect(plan?.stops.find((s) => s.type === "break")?.cost).toBe(0);
    expect(plan?.cost).toBe(0);
  });
  it("retains a feasible visit when the requested break cannot fit", () => {
    const plan = buildItinerary(
      [venue("first", { duration: [100, 100] })],
      { ...DEFAULT_QUERY, minutes: 120 },
      env,
      emptyState(),
      { food: true },
    );
    expect(plan?.minutes).toBe(110);
    expect(plan?.stops.some((s) => s.type === "break")).toBe(false);
  });
  it("honours skipped venues and does not send a second visit past closing or sunset", () => {
    const plan = buildItinerary(
      [
        venue("skip"),
        venue("first", { duration: [60, 60] }),
        venue("too-late", { duration: [30, 30], daylightOnly: true }),
      ],
      DEFAULT_QUERY,
      { ...env, weather: { ...env.weather, sunset: "2026-10-07T11:20:00Z" } },
      emptyState(),
      { food: false, skip: ["skip"] },
    );
    expect(
      plan?.stops.filter((s) => s.type === "place").map((s) => s.placeId),
    ).toEqual(["first"]);
  });
});
