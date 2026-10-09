import { describe, expect, it } from "vitest";
import { parseIntent, rankPlaces } from "../src/domain/discovery";
import {
  DEFAULT_QUERY,
  type Environment,
  type Place,
} from "../src/domain/models";
import { PLACES } from "../src/providers/places";
import { venueSuitability } from "../src/domain/venue-suitability";
import { emptyState } from "../src/providers/persistence";

const env: Environment = {
  location: { name: "Home", lat: 51.3, lng: -0.8 },
  now: "2026-10-09T11:00:00Z",
  weather: {
    kind: "sunny",
    temperature: 18,
    rain: 0,
    wind: 5,
    visibility: 10,
    sunrise: "2026-10-09T06:00:00Z",
    sunset: "2026-10-09T18:00:00Z",
    observedAt: "2026-10-09T11:00:00Z",
    source: "simulation",
  },
  failures: [],
  reducedMotion: false,
};
function venue(
  id: string,
  category = "museum",
  extra: Partial<Place> = {},
): Place {
  return {
    id,
    name: id,
    category,
    area: "Local",
    coordinates: env.location,
    description: "A local outing",
    tagline: "Explore",
    environment: "mixed",
    intents: ["culture"],
    company: ["solo", "couple", "family", "friends"],
    duration: [30, 60],
    cost: 0,
    costLabel: "Free",
    novelty: 0.5,
    daylightOnly: false,
    website: "",
    source: "osm",
    notes: [],
    ...extra,
  };
}
const rank = (places: Place[], query = DEFAULT_QUERY, state = emptyState()) =>
  rankPlaces(places, query, env, state);

describe("V2 eligibility and relevance", () => {
  it("requires explicit opt-ins, including allowing fitness when selected", () => {
    const records = [
      venue("meal", "restaurant", { intents: ["food"] }),
      venue("pub", "pub"),
      venue("gym", "fitness"),
      venue("shop", "shop"),
    ];
    expect(rank(records)).toEqual([]);
    for (const category of ["food", "pubs", "fitness", "shops"] as const) {
      expect(
        rank(records, { ...DEFAULT_QUERY, includeCategories: [category] }),
      ).toHaveLength(1);
      expect(
        rank(records, { ...DEFAULT_QUERY, activity: category }),
      ).toHaveLength(1);
    }
    expect(rank(records, { ...DEFAULT_QUERY, intent: "active" })).toEqual([]);
  });
  it("fails closed on access, strict child ages and uncheckable height limits", () => {
    const unknown = venue("unknown");
    const accessible = venue("accessible", "museum", {
      access: { wheelchair: "yes", stepFree: "yes", dogs: "yes" },
      ageRange: [1, 17],
    });
    expect(
      rank([unknown, accessible], {
        ...DEFAULT_QUERY,
        accessNeeds: { wheelchair: true, stepFree: true, dogs: true },
      }).map((r) => r.place.id),
    ).toEqual(["accessible"]);
    const family = {
      ...DEFAULT_QUERY,
      company: "family" as const,
      childrenAges: [3, 10],
      strictSuitability: true,
    };
    expect(
      rank(
        [
          unknown,
          accessible,
          venue("young", "museum", { ageRange: [1, 5] }),
          venue("height", "adventure", {
            ageRange: [1, 17],
            heightRange: [100, null],
          }),
        ],
        family,
      ).map((r) => r.place.id),
    ).toEqual(["accessible"]);
  });
  it("puts a relevant farther venue ahead of a nearby unrelated venue", () => {
    const farther = venue("culture", "museum", {
      coordinates: { lat: 51.39, lng: -0.8 },
      novelty: 0.1,
    });
    const nearby = venue("park", "park", {
      intents: ["walk"],
      novelty: 1,
      environment: "outdoor",
    });
    expect(
      rank([nearby, farther], { ...DEFAULT_QUERY, intent: "culture" })[0].place
        .id,
    ).toBe("culture");
  });
  it("parses multiple interests without narrowing to one activity", () => {
    expect(
      parseIntent(
        "museum or woodland walk with coffee and a pub",
        DEFAULT_QUERY,
      ),
    ).toMatchObject({
      interests: ["walk", "culture", "food"],
      environment: "any",
      activity: "any",
      includeCategories: ["food", "pubs"],
    });
    expect(
      parseIntent("a wheelchair accessible gym", DEFAULT_QUERY),
    ).toMatchObject({
      activity: "fitness",
      includeCategories: ["fitness"],
      accessNeeds: { wheelchair: true },
    });
  });
});

describe("V2 diversity and novelty", () => {
  it("recognises curated heathland as nature when applying the first-three cap", () => {
    const yateley = PLACES.find((place) => place.name === "Yateley Common")!;
    expect(yateley).toBeDefined();
    expect(venueSuitability(yateley).kind).toBe("nature");
    const parks = [
      venue("heath", yateley.category, { intents: ["walk"], quality: 1 }),
      venue("pond", "nature reserve", { intents: ["walk"], quality: 1 }),
    ];
    const result = rank([...parks, venue("museum"), venue("cinema", "cinema")]);
    expect(
      result
        .slice(0, 3)
        .filter((item) => venueSuitability(item.place).kind === "nature"),
    ).toHaveLength(1);
    expect(venueSuitability(venue("heath", "Heath")).kind).toBe("nature");
  });

  it("caps nature in the first six close peers unless nature is requested", () => {
    const parks = Array.from({ length: 8 }, (_, i) =>
      venue(`park${i}`, "park", { intents: ["walk"], novelty: 1 }),
    );
    const other = [
      venue("museum"),
      venue("cinema", "cinema"),
      venue("zoo", "zoo"),
      venue("bowling", "bowling"),
    ];
    const kinds = rank([...parks, ...other])
      .slice(0, 6)
      .map((r) => r.place.category);
    expect(
      kinds.slice(0, 3).filter((category) => category === "park").length,
    ).toBeLessThanOrEqual(1);
    expect(kinds.filter((category) => category === "park")).toHaveLength(2);
    expect(new Set(kinds).size).toBe(5);
    expect(
      rank([...parks, ...other], { ...DEFAULT_QUERY, intent: "walk" })
        .slice(0, 6)
        .every((r) => r.place.category === "park"),
    ).toBe(true);
  });
  it("keeps the first-three nature cap when weather and evidence scores put alternatives outside the initial score band", () => {
    const parks = Array.from({ length: 4 }, (_, i) =>
      venue(`sunny-park${i}`, "park", {
        intents: ["walk"],
        environment: "outdoor",
        novelty: 1,
        quality: 1,
        hours: [{ days: [5], open: 0, close: 1440 }],
      }),
    );
    const indoor = [
      venue("museum", "museum", {
        environment: "indoor",
        novelty: 0,
        cost: null,
      }),
      venue("cinema", "cinema", {
        environment: "indoor",
        novelty: 0,
        cost: null,
      }),
    ];
    const results = rank([...parks, ...indoor]);
    const nature = results.filter((item) => item.place.category === "park");
    const alternatives = results.filter(
      (item) => item.place.environment === "indoor",
    );
    expect(nature[0].score - alternatives[0].score).toBeGreaterThan(12);
    expect(
      results.slice(0, 3).filter((item) => item.place.category === "park"),
    ).toHaveLength(1);
    expect(results.slice(0, 3).map((item) => item.place.id)).toEqual(
      expect.arrayContaining(["museum", "cinema"]),
    );
  });
  it("keeps relevance ahead of diversity without unrelated fillers", () => {
    const parks = Array.from({ length: 3 }, (_, i) =>
      venue(`nature${i}`, "park", { intents: ["relax"] }),
    );
    const unrelated = venue("unrelated", "museum", { intents: ["culture"] });
    expect(
      rank([...parks, unrelated], { ...DEFAULT_QUERY, intent: "relax" })
        .slice(0, 3)
        .every((item) => item.place.category === "park"),
    ).toBe(true);
    expect(
      rank([venue("gallery", "gallery")], {
        ...DEFAULT_QUERY,
        intent: "culture",
      })[0].explanation,
    ).toBe("Fits your interest in culture.");
  });
  it("excludes duplicate identities and parent attractions", () => {
    const main = venue("main");
    const duplicate = venue("duplicate", "museum", { name: "main" });
    const child = venue("ride", "cinema", { parentId: "main" });
    expect(rank([main, main, duplicate, child])).toHaveLength(1);
  });
  it("reduces repeat impressions while keeping old impressions and photos neutral", () => {
    const a = venue("a"),
      b = venue("b");
    const state = emptyState();
    state.impressions = [
      { id: "a", date: env.now },
      { id: "a", date: env.now },
      { id: "b", date: "2026-08-01T11:00:00Z" },
    ];
    expect(rank([a, b], DEFAULT_QUERY, state)[0].place.id).toBe("b");
    expect(rank([a])[0].components.quality).toBe(0);
    const photo = {
      url: "/test.jpg",
      credit: "Artist",
      license: "CC0",
      source: "example",
    };
    expect(rank([{ ...a, image: photo }])[0].score).toBe(rank([a])[0].score);
  });
});
