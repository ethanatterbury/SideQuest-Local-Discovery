import { describe, expect, it } from "vitest";
import { parseIntent, rankPlaces } from "../src/domain/discovery";
import {
  DEFAULT_QUERY,
  type Environment,
  type Place,
} from "../src/domain/models";
import { emptyState, validatedPreferences } from "../src/providers/persistence";
const env: Environment = {
  location: { name: "Home", lat: 51.3, lng: -0.8 },
  now: "2026-10-07T11:00:00+01:00",
  weather: {
    kind: "sunny",
    temperature: 18,
    rain: 0,
    wind: 5,
    visibility: 10,
    sunrise: "2026-10-07T07:00:00+01:00",
    sunset: "2026-10-07T18:30:00+01:00",
    observedAt: "2026-10-07T11:00:00+01:00",
    source: "simulation",
  },
  reducedMotion: false,
  failures: [],
};
const place: Place = {
  id: "play",
  name: "Play centre",
  area: "Local",
  coordinates: env.location,
  category: "play",
  description: "Play",
  tagline: "Play",
  environment: "indoor",
  intents: ["kids"],
  company: ["family"],
  duration: [30, 60],
  cost: 5,
  costLabel: "£5",
  novelty: 0.5,
  daylightOnly: false,
  website: "https://example.com",
  source: "https://example.com",
  notes: [],
};
const query = {
  ...DEFAULT_QUERY,
  company: "family" as const,
  intent: "kids" as const,
};
describe("family ages", () => {
  it("does not infer unknown ages or claim unknown venue suitability", () => {
    expect(
      parseIntent("toddlers soft play", DEFAULT_QUERY).childrenAges,
    ).toBeUndefined();
    const results = rankPlaces(
      [place, { ...place, id: "limited", ageRange: [0, 5] }],
      query,
      env,
      emptyState(),
    );
    expect(results).toHaveLength(2);
    expect(
      results.every((result) =>
        result.reasons.includes("Check age suitability with the venue"),
      ),
    ).toBe(true);
  });
  it("requires every child to fit verified venue age guidance", () => {
    const results = rankPlaces(
      [
        { ...place, id: "young", ageRange: [0, 5] },
        { ...place, id: "all", ageRange: [0, 17] },
        place,
      ],
      { ...query, childrenAges: [2, 10] },
      env,
      emptyState(),
    );
    expect(results.map((result) => result.place.id)).not.toContain("young");
    expect(results.map((result) => result.place.id)).toContain("all");
    expect(
      results.find((result) => result.place.id === "play")?.reasons,
    ).toContain("Check age suitability with the venue");
  });
  it("boosts soft play for young children and museums for older children", () => {
    const venues = [
      { ...place, id: "soft", familyFeatures: ["soft-play"] },
      { ...place, id: "museum", familyFeatures: ["museum"] },
    ];
    expect(
      rankPlaces(venues, { ...query, childrenAges: [2] }, env, emptyState())[0]
        .place.id,
    ).toBe("soft");
    expect(
      rankPlaces(venues, { ...query, childrenAges: [10] }, env, emptyState())[0]
        .place.id,
    ).toBe("museum");
  });
  it("parses explicit ages and keeps family museum intent", () => {
    expect(
      parseIntent("soft-play for children aged 2 and 5", DEFAULT_QUERY),
    ).toMatchObject({
      company: "family",
      intent: "kids",
      environment: "indoor",
      childrenAges: [2, 5],
    });
    expect(parseIntent("museum with kids", DEFAULT_QUERY).intent).toBe("kids");
    expect(
      parseIntent("with my 3-year-old", DEFAULT_QUERY).childrenAges,
    ).toEqual([3]);
  });
  it("accepts exact ages and rejects malformed or unbounded saved ages", () => {
    expect(
      validatedPreferences({ childrenAges: [0, 17] }).childrenAges,
    ).toEqual([0, 17]);
    expect(validatedPreferences({ childrenAges: [] }).childrenAges).toEqual([]);
    for (const childrenAges of [
      [-1],
      [18],
      [2.5],
      [NaN],
      ["2"],
      Array(9).fill(2),
      "2",
      null,
    ]) {
      expect(
        validatedPreferences({ childrenAges }).childrenAges,
      ).toBeUndefined();
    }
  });
});

describe("activity browsing", () => {
  it("filters soft play and playgrounds without accepting generic family venues", () => {
    const venues = [
      place,
      { ...place, id: "soft", category: "Soft play" },
      { ...place, id: "ground", familyFeatures: ["playground"] },
    ];
    expect(
      rankPlaces(
        venues,
        { ...query, activity: "soft-play" },
        env,
        emptyState(),
      ).map((result) => result.place.id),
    ).toEqual(["soft"]);
    expect(
      rankPlaces(
        venues,
        { ...query, activity: "playground" },
        env,
        emptyState(),
      ).map((result) => result.place.id),
    ).toEqual(["ground"]);
    expect(
      rankPlaces(venues, { ...query, activity: "any" }, env, emptyState()),
    ).toHaveLength(3);
  });
  it("parses requested activities and persists without inventing child ages", () => {
    expect(parseIntent("soft play", DEFAULT_QUERY).activity).toBe("soft-play");
    expect(parseIntent("museum", DEFAULT_QUERY).activity).toBe("museum");
    expect(
      validatedPreferences({ company: "family", activity: "soft-play" }),
    ).toEqual({ company: "family", activity: "soft-play" });
    expect(
      validatedPreferences({ activity: "unknown" }).activity,
    ).toBeUndefined();
  });
});

it("describes one-sided sourced age limits without inventing the other bound", () => {
  const results = rankPlaces(
    [
      { ...place, id: "minimum", ageRange: [5, 99] },
      { ...place, id: "maximum", ageRange: [0, 12] },
    ],
    { ...query, childrenAges: [7] },
    env,
    emptyState(),
  );
  expect(
    results.find((result) => result.place.id === "minimum")?.reasons,
  ).toContain("Venue reports minimum age 5; confirm other limits");
  expect(
    results.find((result) => result.place.id === "maximum")?.reasons,
  ).toContain("Venue reports an upper age limit 12; check minimum age");
});
