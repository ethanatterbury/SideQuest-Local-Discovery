import { describe, expect, it } from "vitest";
import { rankPlaces } from "@/domain/discovery";
import { DEFAULT_QUERY, type Environment, type Place } from "@/domain/models";
import {
  inferVenueSuitability,
  venueSuitability,
} from "@/domain/venue-suitability";
import { emptyState } from "@/providers/persistence";

const env: Environment = {
  location: { name: "Test", lat: 51.3, lng: -0.8 },
  now: "2026-10-30T12:00:00Z",
  weather: {
    kind: "sunny",
    temperature: 16,
    rain: 0,
    wind: 5,
    visibility: 10,
    sunrise: "2026-10-30T07:00:00Z",
    sunset: "2026-10-30T17:00:00Z",
    observedAt: "2026-10-30T12:00:00Z",
    source: "simulation",
  },
  failures: [],
  reducedMotion: true,
};
function venue(
  id: string,
  category: string,
  extra: Partial<Place> = {},
): Place {
  return {
    id,
    name: id,
    category,
    area: "Test",
    coordinates: env.location,
    description: "",
    tagline: "",
    environment: "mixed",
    intents: ["unusual"],
    company: ["solo", "couple", "family", "friends"],
    duration: [30, 60],
    cost: null,
    costLabel: "Check prices",
    novelty: 0.5,
    daylightOnly: false,
    website: "",
    source: "https://www.openstreetmap.org/node/1",
    notes: [],
    ...extra,
  };
}

describe("recommendation evidence", () => {
  it.each(["Museum", "Country park", "Aquarium"])(
    "keeps a %s with incidental play discoverable for adults",
    (category) => {
      const place = venue("visit", category, {
        familyFeatures: ["Playground"],
      });
      expect(
        rankPlaces([place], DEFAULT_QUERY, env, emptyState()),
      ).toHaveLength(1);
      expect(venueSuitability(place).audience).toBe("all");
    },
  );
  it("does not treat a cafe's incidental playground as its primary play experience", () => {
    const place = venue("cafe", "Café", { familyFeatures: ["Playground"] });
    expect(
      rankPlaces(
        [place],
        {
          ...DEFAULT_QUERY,
          company: "family",
          activity: "playground",
          includeCategories: ["food"],
        },
        env,
        emptyState(),
      ),
    ).toEqual([]);
  });
  it("corrects an old incidental-play classification using the mapped primary category", () => {
    const place = venue("museum", "Museum", {
      familyFeatures: ["Playground"],
      suitability: inferVenueSuitability({
        category: "Playground",
        intents: [],
      }),
    });
    expect(rankPlaces([place], DEFAULT_QUERY, env, emptyState())).toHaveLength(
      1,
    );
    expect(venueSuitability(place).kind).toBe("culture");
  });
  it("ranks a specific unusual outing before generic attraction defaults while retaining every record", () => {
    const generic = Array.from({ length: 12 }, (_, i) =>
      venue(`generic-${i}`, "Local attraction", {
        novelty: 1,
        quality: 1,
        environment: "outdoor",
        hours: [{ days: [5], open: 0, close: 1440 }],
      }),
    );
    const museum = venue("museum", "Museum", { environment: "indoor" });
    const results = rankPlaces(
      [...generic, museum],
      { ...DEFAULT_QUERY, intent: "unusual" },
      env,
      emptyState(),
    );
    expect(results).toHaveLength(13);
    expect(results[0].place.id).toBe("museum");
  });
  it("keeps unknown prices and hours eligible without rewarding generic category uncertainty", () => {
    const results = rankPlaces(
      [venue("a-generic", "Local attraction"), venue("z-specific", "Museum")],
      DEFAULT_QUERY,
      env,
      emptyState(),
    );
    expect(results).toHaveLength(2);
    expect(results[0].place.id).toBe("z-specific");
  });
  it("uses evidenced primary experiences on a generic attraction without an uncertainty penalty", () => {
    const place = venue("mapped-museum", "Local attraction", {
      experiences: [
        {
          activities: ["museum"],
          primary: true,
          evidence: {
            source: "osm",
            confidence: "reported",
            url: "https://www.openstreetmap.org/node/1",
          },
        },
      ],
    });
    const [result] = rankPlaces(
      [place],
      { ...DEFAULT_QUERY, intent: "unusual" },
      env,
      emptyState(),
    );
    expect(result.components.intent).toBe(36);
    expect(result.components.categoryEvidence).toBe(0);
    expect(result.explanation).toContain("Fits your interest");
  });
  it("does not claim a generic mapped attraction is confirmed to be unusual", () => {
    const [result] = rankPlaces(
      [venue("generic", "Local attraction")],
      {
        ...DEFAULT_QUERY,
        intent: "unusual",
      },
      env,
      emptyState(),
    );
    expect(result.explanation).not.toContain("Fits your interest");
  });
});
