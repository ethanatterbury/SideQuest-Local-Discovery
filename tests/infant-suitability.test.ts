import { describe, expect, it } from "vitest";
import { DEFAULT_QUERY, type Environment, type Place } from "@/domain/models";
import { rankPlaces } from "@/domain/discovery";
import { buildItinerary } from "@/domain/itinerary";
import { rankMapPlaces } from "@/features/map/map-food";
import { emptyState } from "@/providers/persistence";
import { normalizeOsmElement } from "@/providers/nearby-places";
import { inferVenueSuitability } from "@/domain/venue-suitability";
import regional from "@/providers/data/regional-osm.json";
const env: Environment = {
  location: { name: "Sandhurst", lat: 51.347, lng: -0.8 },
  now: "2026-10-26T12:00:00Z",
  weather: {
    kind: "sunny",
    temperature: 15,
    rain: 0,
    wind: 5,
    visibility: 15,
    sunrise: "2026-10-26T07:00:00Z",
    sunset: "2026-10-26T17:00:00Z",
    observedAt: "2026-10-26T12:00:00Z",
    source: "simulation",
  },
  reducedMotion: true,
  failures: [],
};
const baby = {
  ...DEFAULT_QUERY,
  company: "family" as const,
  childrenAges: [0],
};
function venue(category: string, extra: Partial<Place> = {}): Place {
  return {
    id: category,
    name: category,
    category,
    area: "Test",
    coordinates: env.location,
    description: "",
    tagline: "",
    environment: "indoor",
    intents: ["kids"],
    company: ["family"],
    duration: [30, 60],
    cost: 0,
    costLabel: "Free",
    novelty: 0.8,
    daylightOnly: false,
    website: "https://example.org",
    source: "https://example.org",
    notes: [],
    ...extra,
  };
}
describe("infant activity eligibility", () => {
  it("excludes the real bowling record even when restored from an old cached classification", () => {
    const raw = regional.elements.find(
      (e) => e.tags.leisure === "bowling_alley",
    )!;
    expect(raw).toBeDefined();
    const place = { ...normalizeOsmElement(raw)!, coordinates: env.location };
    place.suitability = {
      ...inferVenueSuitability(place),
      requiresAgeCheck: false,
    };
    for (const mode of ["normal", "surprise"] as const) {
      const query = { ...baby, mode };
      expect(rankPlaces([place], query, env, emptyState())).toEqual([]);
      expect(rankMapPlaces([place], query, env, emptyState())).toEqual([]);
      expect(
        buildItinerary([place], query, env, emptyState(), { food: false }),
      ).toBeNull();
    }
  });
  it.each([
    "Bowling alley",
    "Miniature golf",
    "Climbing",
    "Swimming pool",
    "Cinema",
    "Soft play",
    "Playground",
    "Attraction",
  ])("does not treat generic %s as an infant experience", (category) => {
    expect(
      rankPlaces(
        [venue(category, { ageRange: [0, 12] })],
        baby,
        env,
        emptyState(),
      ),
    ).toEqual([]);
  });
  it.each(["Soft play", "Cinema"])(
    "requires infant-specific evidence for %s instead of a family tag, baby name or changing table",
    (category) => {
      const place = venue(category, {
        name: "Baby fun",
        familyFeatures: ["Changing table"],
        ageRange: [0, 5],
      });
      expect(rankPlaces([place], baby, env, emptyState())).toEqual([]);
      expect(
        rankPlaces(
          [
            {
              ...place,
              evidence: {
                infantSuitability: {
                  source: "official",
                  confidence: "verified",
                  url: "https://example.org/baby-sessions",
                  checkedAt: "2026-10-26",
                },
              },
            },
          ],
          baby,
          env,
          emptyState(),
        ),
      ).toHaveLength(1);
    },
  );
  it("retains ordinary family outings without claiming infant participation", () => {
    for (const category of ["Country park", "Museum", "Aquarium"])
      expect(
        rankPlaces([venue(category)], baby, env, emptyState()),
      ).toHaveLength(1);
  });
  it("keeps a museum, park or zoo visit with incidental play facilities, without recommending infant play", () => {
    for (const category of ["Country park", "Museum", "Aquarium"]) {
      const place = venue(category, { familyFeatures: ["Playground"] });
      expect(rankPlaces([place], baby, env, emptyState())).toHaveLength(1);
      expect(
        rankPlaces(
          [place],
          { ...baby, activity: "playground" },
          env,
          emptyState(),
        ),
      ).toEqual([]);
    }
    expect(
      rankPlaces(
        [venue("Soft play", { familyFeatures: ["Museum"] })],
        baby,
        env,
        emptyState(),
      ),
    ).toEqual([]);
  });
  it("still applies every child's sourced age limits and preserves supported older-child bowling", () => {
    const bowling = venue("Bowling alley", { ageRange: [4, 17] });
    expect(
      rankPlaces(
        [bowling],
        { ...baby, childrenAges: [0, 8] },
        env,
        emptyState(),
      ),
    ).toEqual([]);
    expect(
      rankPlaces([bowling], { ...baby, childrenAges: [8] }, env, emptyState()),
    ).toHaveLength(1);
  });
});
