import { describe, it, expect } from "vitest";
import {
  rankPlaces,
  parseIntent,
  openingStatus,
} from "../src/domain/discovery";
import { buildItinerary } from "../src/domain/itinerary";
import { applyOverrides } from "../src/domain/environment";
import { emptyState, LocalPersistence } from "../src/providers/persistence";
import {
  DEFAULT_QUERY,
  type Environment,
  type Place,
} from "../src/domain/models";
const env: Environment = {
  location: { name: "Sandhurst", lat: 51.347, lng: -0.8 },
  now: "2026-10-07T11:00:00+01:00",
  weather: {
    kind: "sunny",
    temperature: 18,
    rain: 0,
    wind: 8,
    visibility: 10,
    sunrise: "2026-10-07T07:00:00+01:00",
    sunset: "2026-10-07T18:30:00+01:00",
    source: "simulation",
    observedAt: "2026-10-07T11:00:00+01:00",
  },
  reducedMotion: false,
  failures: [],
};
const park: Place = {
  id: "park",
  name: "Park",
  area: "Surrey",
  coordinates: { lat: 51.35, lng: -0.8 },
  category: "woodland",
  description: "Walk",
  tagline: "Walk",
  environment: "outdoor",
  intents: ["walk", "scenic"],
  company: ["couple", "family"],
  duration: [60, 120],
  cost: 0,
  costLabel: "Free entry",
  novelty: 0.5,
  daylightOnly: true,
  website: "https://example.com",
  source: "https://example.com",
  notes: [],
};
const indoor: Place = {
  ...park,
  id: "museum",
  name: "Museum",
  environment: "indoor",
  daylightOnly: false,
  intents: ["culture"],
  cost: 10,
  costLabel: "Check tickets",
};
describe("contextual ranking", () => {
  it("excludes woodland in darkness", () => {
    expect(
      rankPlaces(
        [park, indoor],
        DEFAULT_QUERY,
        { ...env, now: "2026-10-07T23:00:00+01:00" },
        emptyState(),
      ).map((r) => r.place.id),
    ).toEqual(["museum"]);
  });
  it("excludes outdoor-only choices in thunderstorms", () => {
    expect(
      rankPlaces(
        [park, indoor],
        DEFAULT_QUERY,
        { ...env, weather: { ...env.weather, kind: "thunderstorm" } },
        emptyState(),
      ).map((r) => r.place.id),
    ).toEqual(["museum"]);
  });
  it("ranks sheltered options higher in heavy rain", () => {
    expect(
      rankPlaces(
        [park, indoor],
        DEFAULT_QUERY,
        { ...env, weather: { ...env.weather, kind: "heavy-rain" } },
        emptyState(),
      )[0].place.id,
    ).toBe("museum");
  });
  it("does not describe unavailable weather as dry", () => {
    expect(
      rankPlaces(
        [park],
        DEFAULT_QUERY,
        { ...env, weather: { ...env.weather, source: "unavailable" } },
        emptyState(),
      )[0].explanation,
    ).toContain("Weather unavailable");
  });
  it("excludes known prices above budget", () => {
    expect(
      rankPlaces([indoor], { ...DEFAULT_QUERY, budget: 0 }, env, emptyState()),
    ).toHaveLength(0);
  });
  it("limits total time including return travel", () => {
    expect(
      rankPlaces([park], { ...DEFAULT_QUERY, minutes: 30 }, env, emptyState()),
    ).toHaveLength(0);
  });
  it("suppresses recent visits without permanent dismissal for not today", () => {
    const state = emptyState();
    state.visits = [
      { id: "park", date: env.now, reaction: "Loved it", note: "", km: 1 },
    ];
    expect(
      rankPlaces([park, indoor], DEFAULT_QUERY, env, state)[0].place.id,
    ).toBe("museum");
  });
  it("unknown opening hours remain unknown", () => {
    expect(openingStatus(park, env.now).status).toBe("unknown");
  });
  it("excludes a venue closing before a viable visit", () => {
    const p = { ...indoor, hours: [{ days: [3], open: 600, close: 665 }] };
    expect(rankPlaces([p], DEFAULT_QUERY, env, emptyState())).toHaveLength(0);
  });
  it("opening time follows Europe London across DST", () => {
    expect(
      openingStatus(
        { ...indoor, hours: [{ days: [3], open: 660, close: 1020 }] },
        "2026-10-07T10:00:00Z",
      ).status,
    ).toBe("open");
  });
  it("interprets natural language without claiming AI", () => {
    const q = parseIntent(
      "something indoors with kids for 2 hours within 15 minutes free",
      DEFAULT_QUERY,
    );
    expect(q).toMatchObject({
      environment: "indoor",
      company: "family",
      minutes: 120,
      travel: 15,
      budget: 0,
    });
  });
});
describe("itinerary constraints", () => {
  it("caps the full first visit at sunset after arrival", () => {
    const late = { ...env, now: "2026-10-07T17:00:00+01:00" };
    const plan = buildItinerary([park], DEFAULT_QUERY, late, emptyState(), {
      food: false,
    });
    const stop = plan!.stops.find((s) => s.type === "place")!;
    expect(
      new Date(stop.at).getTime() + stop.minutes * 60000,
    ).toBeLessThanOrEqual(new Date(env.weather.sunset).getTime());
    expect(stop.minutes).toBeGreaterThanOrEqual(park.duration[0]);
  });
  it("caps the full first visit at a verified closing time", () => {
    const venue = { ...indoor, hours: [{ days: [3], open: 600, close: 740 }] };
    const plan = buildItinerary([venue], DEFAULT_QUERY, env, emptyState(), {
      food: false,
    });
    const stop = plan!.stops.find((s) => s.type === "place")!;
    expect(stop.minutes).toBeLessThanOrEqual(
      openingStatus(venue, stop.at).remaining!,
    );
    expect(stop.minutes).toBeGreaterThanOrEqual(venue.duration[0]);
  });
  it("never exceeds the available round trip window", () => {
    const plan = buildItinerary(
      [park, indoor],
      DEFAULT_QUERY,
      env,
      emptyState(),
      { food: true },
    );
    expect(plan).not.toBeNull();
    expect(plan!.minutes).toBeLessThanOrEqual(180);
    expect(plan!.stops.at(-1)!.type).toBe("home");
    expect(plan!.cost).toBeLessThanOrEqual(40);
  });
  it("cannot create a plan with no eligible stop", () => {
    expect(
      buildItinerary(
        [park],
        { ...DEFAULT_QUERY, minutes: 20 },
        env,
        emptyState(),
        { food: false },
      ),
    ).toBeNull();
  });
  it("does not claim an unknown ticket price fits a free budget", () => {
    expect(
      rankPlaces(
        [{ ...indoor, cost: null }],
        { ...DEFAULT_QUERY, budget: 0 },
        env,
        emptyState(),
      ),
    ).toHaveLength(0);
  });
  it("excludes distant second stops", () => {
    const far = { ...indoor, id: "far", coordinates: { lat: 55, lng: -2 } };
    const p = buildItinerary([park, far], DEFAULT_QUERY, env, emptyState(), {
      food: false,
    });
    expect(p!.stops.map((s) => s.placeId)).not.toContain("far");
  });
});
describe("environment and persistence", () => {
  it("applies independent centralized overrides", () => {
    const r = applyOverrides(env, {
      weather: "heavy-rain",
      time: "midnight",
      failures: ["map"],
      reducedMotion: true,
    });
    expect(r.weather.kind).toBe("heavy-rain");
    expect(r.reducedMotion).toBe(true);
    expect(r.failures).toEqual(["map"]);
    expect(new Date(r.now).getUTCHours()).toBe(23);
  });
  it("validates stored data and recovers malformed JSON", () => {
    const store = new LocalPersistence({
      getItem: () => "{bad",
      setItem: () => {},
    });
    expect(store.read().saved).toEqual([]);
  });
  it("continues in memory if storage is blocked", () => {
    const store = new LocalPersistence({
      getItem: () => {
        throw Error("blocked");
      },
      setItem: () => {
        throw Error("blocked");
      },
    });
    store.write({ ...emptyState(), saved: ["park"] });
    expect(store.read().saved).toEqual(["park"]);
    expect(store.available).toBe(false);
  });
  it("rejects malformed collections and visits", () => {
    const store = new LocalPersistence({
      getItem: () =>
        JSON.stringify({
          version: 1,
          saved: ["park"],
          visits: [{}],
          collections: [{}],
        }),
      setItem: () => {},
    });
    expect(store.read().visits).toEqual([]);
    expect(store.read().collections).toHaveLength(5);
  });
});

describe("persistent personalization", () => {
  it("round trips validated query preferences", () => {
    let raw = "";
    const store = new LocalPersistence({
      getItem: () => raw,
      setItem: (_k, v) => {
        raw = v;
      },
    });
    store.write({
      ...emptyState(),
      preferences: {
        company: "family",
        budget: 15,
        travel: 45,
        intent: "kids",
      },
    });
    expect(store.read().preferences).toMatchObject({
      company: "family",
      budget: 15,
      travel: 45,
      intent: "kids",
    });
  });
  it("negative visit feedback affects later recommendations", () => {
    const state = emptyState();
    state.visits = [
      {
        id: "park",
        date: "2026-01-01T12:00:00Z",
        reaction: "Not again",
        note: "",
        km: 1,
      },
    ];
    const ordinary = rankPlaces([park], DEFAULT_QUERY, env, emptyState())[0]
      .score;
    expect(rankPlaces([park], DEFAULT_QUERY, env, state)[0].score).toBeLessThan(
      ordinary - 10,
    );
  });
  it("disables exposed outdoor choices when wind slider is hazardous", () => {
    const windy = {
      ...env,
      weather: { ...env.weather, kind: "sunny" as const, wind: 75 },
    };
    expect(
      rankPlaces(
        [{ ...park, exposed: true }],
        DEFAULT_QUERY,
        windy,
        emptyState(),
      ),
    ).toHaveLength(0);
  });
  it("uses heat slider in weather fit, independent of named preset", () => {
    const ordinary = rankPlaces(
      [{ ...park, exposed: true }],
      DEFAULT_QUERY,
      env,
      emptyState(),
    )[0].score;
    const hot = { ...env, weather: { ...env.weather, temperature: 36 } };
    expect(
      rankPlaces(
        [{ ...park, exposed: true }],
        DEFAULT_QUERY,
        hot,
        emptyState(),
      )[0].score,
    ).toBeLessThan(ordinary);
  });
});

it("ignores invalid persisted preference values", () => {
  const store = new LocalPersistence({
    getItem: () =>
      JSON.stringify({
        ...emptyState(),
        preferences: { budget: -3, travel: Infinity, company: "unknown" },
      }),
    setItem: () => {},
  });
  expect(store.read().preferences).toEqual({});
});
it("rejects incomplete stored itineraries", () => {
  const store = new LocalPersistence({
    getItem: () =>
      JSON.stringify({
        ...emptyState(),
        plans: [{ id: "broken", stops: [], minutes: 10 }],
      }),
    setItem: () => {},
  });
  expect(store.read().plans).toEqual([]);
});

describe("photo-independent discovery", () => {
  it("keeps eligibility, scores, Get Me Out and Surprise choices identical after enrichment", () => {
    const records = [park, indoor];
    const enriched = records.map((p) => ({
      ...p,
      image: {
        url: "/photo.jpg",
        credit: "Author",
        license: "CC0",
        source: "https://example.com",
        confidence: 0.99,
      },
      commons: "File:Photo.jpg",
      aliases: ["Photo alias"],
    }));
    for (const mode of ["normal", "surprise"] as const) {
      const query = { ...DEFAULT_QUERY, mode };
      const summarize = (data: Place[]) =>
        rankPlaces(data, query, env, emptyState()).map((r) => ({
          id: r.place.id,
          score: r.score,
          components: r.components,
          travel: r.travel,
          reasons: r.reasons,
        }));
      expect(summarize(enriched)).toEqual(summarize(records));
      expect(
        buildItinerary(enriched, query, env, emptyState(), { food: true }),
      ).toEqual(
        buildItinerary(records, query, env, emptyState(), { food: true }),
      );
    }
  });
});
