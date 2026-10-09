import { describe, expect, it } from "vitest";
import {
  effectiveDiscoveryQuery,
  matchesActivity,
  parseIntent,
  rankPlaces,
} from "../src/domain/discovery";
import {
  DEFAULT_QUERY,
  type Environment,
  type Place,
} from "../src/domain/models";
import { buildItinerary } from "../src/domain/itinerary";
import {
  changeActivity,
  changeCompany,
  isChildOuting,
} from "../src/domain/venue-suitability";
import { normalizeOsmElement } from "../src/providers/nearby-places";
import regionalSnapshot from "../src/providers/data/regional-osm.json";
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

describe("real venue audience regressions", () => {
  const names = [
    "Anytime Fitness",
    "Plastic Playground Wake Park",
    "Jump In",
    "Thorpe Lakes Watersports Resort",
  ];
  const venues = names.map((name) => {
    const element = regionalSnapshot.elements.find(
      (record) => record.tags.name === name,
    )!;
    return { ...normalizeOsmElement(element)!, coordinates: env.location };
  });
  const park = normalizeOsmElement({
    type: "node",
    id: 1001,
    lat: env.location.lat,
    lon: env.location.lng,
    tags: { name: "Memorial Park", leisure: "park" },
  })!;
  const museum = normalizeOsmElement({
    type: "node",
    id: 1002,
    lat: env.location.lat,
    lon: env.location.lng,
    tags: { name: "Local Museum", tourism: "museum" },
  })!;
  const soft = normalizeOsmElement({
    type: "node",
    id: 1003,
    lat: env.location.lat,
    lon: env.location.lng,
    tags: { name: "Soft play", leisure: "indoor_play" },
  })!;
  it("excludes fitness membership venues from default discovery for every company", () => {
    for (const company of ["solo", "couple", "friends", "family"] as const)
      expect(
        rankPlaces(
          venues.slice(0, 1),
          { ...DEFAULT_QUERY, company },
          env,
          emptyState(),
        ),
      ).toEqual([]);
  });
  it("keeps only plausible shared outings for a family with ages 1 and 2 in both modes", () => {
    for (const mode of ["normal", "surprise"] as const) {
      const result = rankPlaces(
        [...venues, park, museum, soft],
        { ...query, childrenAges: [1, 2], mode },
        env,
        emptyState(),
      );
      expect(result.map((record) => record.place.name).sort()).toEqual(
        ["Memorial Park", "Local Museum", "Soft play"].sort(),
      );
    }
  });
  it("an exact attraction name preserves venue identity without semantic playground inference", () => {
    expect(
      rankPlaces(
        [...venues, park, museum, soft],
        { ...DEFAULT_QUERY, text: "Plastic Playground Wake Park" },
        env,
        emptyState(),
      ).map((result) => result.place.name),
    ).toEqual(["Plastic Playground Wake Park"]);
    expect(
      rankPlaces(
        [...venues, park, museum, soft],
        {
          ...query,
          childrenAges: [1, 2],
          text: "Plastic Playground Wake Park",
        },
        env,
        emptyState(),
      ),
    ).toEqual([]);
    expect(
      rankPlaces(
        [...venues, park, museum, soft],
        { ...DEFAULT_QUERY, text: "museum" },
        env,
        emptyState(),
      ).map((result) => result.place.id),
    ).toEqual([museum.id]);
  });
  it("itinerary shares the same age and audience exclusions", () => {
    expect(
      buildItinerary(
        venues,
        { ...query, childrenAges: [1, 2] },
        env,
        emptyState(),
        { food: false },
      ),
    ).toBeNull();
    const plan = buildItinerary(
      [...venues, museum, soft],
      { ...query, childrenAges: [1, 2] },
      env,
      emptyState(),
      { food: false },
    );
    expect(plan).not.toBeNull();
    expect(
      plan!.stops
        .filter((stop) => stop.type === "place")
        .every((stop) => [museum.id, soft.id].includes(stop.placeId!)),
    ).toBe(true);
  });
  it("specific intent outweighs novelty and favourable weather on otherwise eligible options", () => {
    const records = [
      { ...park, novelty: 1 },
      { ...museum, novelty: 0.1 },
    ];
    for (const mode of ["normal", "surprise"] as const) {
      expect(
        rankPlaces(
          records,
          { ...DEFAULT_QUERY, intent: "culture", mode },
          env,
          emptyState(),
        )[0].place.id,
      ).toBe(museum.id);
      expect(
        rankPlaces(
          records,
          { ...DEFAULT_QUERY, intent: "walk", mode },
          { ...env, weather: { ...env.weather, kind: "heavy-rain" } },
          emptyState(),
        )[0].place.id,
      ).toBe(park.id);
    }
  });
  it("does not send an adult solo or couple to child-focused play by default", () => {
    for (const company of ["solo", "couple"] as const) {
      const result = rankPlaces(
        [park, museum, soft],
        { ...DEFAULT_QUERY, company },
        env,
        emptyState(),
      );
      expect(result.map((record) => record.place.id)).not.toContain(soft.id);
      expect(result.map((record) => record.place.id)).toEqual(
        expect.arrayContaining([park.id, museum.id]),
      );
      expect(
        rankPlaces(
          [soft],
          { ...DEFAULT_QUERY, company, activity: "soft-play" },
          env,
          emptyState(),
        ),
      ).toHaveLength(1);
    }
  });
  it("gardens and parks excludes aquatic and trampoline attractions even when their name says playground", () => {
    expect(venues.every((venue) => !matchesActivity(venue, "gardens"))).toBe(
      true,
    );
    expect(matchesActivity(venues[1], "playground")).toBe(false);
    expect(matchesActivity(park, "gardens")).toBe(true);
    expect(
      matchesActivity(
        {
          ...park,
          category: "Business park",
          intents: ["unusual"],
          suitability: undefined,
        },
        "gardens",
      ),
    ).toBe(false);
  });
  it("requires every entered age and known guidance for restriction-dependent adventures", () => {
    const jump = venues[2];
    expect(
      rankPlaces(
        [jump],
        { ...query, childrenAges: [2, 10] },
        env,
        emptyState(),
      ),
    ).toEqual([]);
    expect(
      rankPlaces([jump], { ...query, childrenAges: [10] }, env, emptyState()),
    ).toEqual([]);
    expect(
      rankPlaces(
        [{ ...jump, ageRange: [6, 17] }],
        { ...query, childrenAges: [10] },
        env,
        emptyState(),
      ),
    ).toHaveLength(1);
    expect(jump.ageRange).toBeUndefined();
  });
});

it("switching company clears child-specific filters and stale search while retaining ordinary preferences", () => {
  const family = {
    ...query,
    activity: "soft-play" as const,
    childrenAges: [1, 2],
    text: "soft play for kids aged 1 and 2",
  };
  for (const company of ["solo", "couple", "friends"] as const) {
    const changed = changeCompany(family, company);
    expect(changed).toMatchObject({
      company,
      intent: "any",
      activity: "any",
      text: "",
    });
    expect(changed.childrenAges).toBeUndefined();
    expect(changed.budget).toBe(family.budget);
    expect(parseIntent(changed.text, changed).company).toBe(company);
  }
  expect(
    changeCompany({ ...query, activity: "museum", text: "museum" }, "solo"),
  ).toMatchObject({ activity: "museum", text: "museum", intent: "any" });
  expect(changeActivity(DEFAULT_QUERY, "soft-play")).toMatchObject({
    intent: "kids",
    activity: "soft-play",
  });
  expect(
    changeActivity(changeActivity(DEFAULT_QUERY, "soft-play"), "museum").intent,
  ).toBe("any");
});

it("generic family tags are not evidence of a child outing", () => {
  expect(
    isChildOuting({
      ...place,
      company: ["solo", "couple", "family", "friends"],
    }),
  ).toBe(false);
  expect(isChildOuting({ ...place, category: "Playground" })).toBe(true);
});

it("semantic interpretation is idempotent and preserves later collection constraints", () => {
  const derived = effectiveDiscoveryQuery(
    { ...DEFAULT_QUERY, text: "museum for £40" },
    [],
  );
  expect(derived.activity).toBe("museum");
  expect(effectiveDiscoveryQuery(derived, [])).toEqual(derived);
  expect(effectiveDiscoveryQuery({ ...derived, budget: 0 }, []).budget).toBe(0);
});

it("a new company choice clears a stale romantic search as well as child searches", () => {
  const changed = changeCompany(
    { ...DEFAULT_QUERY, intent: "date", text: "romantic museum date" },
    "family",
  );
  expect(changed).toMatchObject({ company: "family", intent: "any", text: "" });
  expect(parseIntent(changed.text, changed).company).toBe("family");
});
