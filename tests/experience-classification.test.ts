import { describe, expect, it } from "vitest";
import {
  isSuitableForQuery,
  optionalCategory,
} from "@/domain/venue-suitability";
import { isMapFoodPlace } from "@/features/map/map-food";
import { normalizeOsmElement } from "@/providers/nearby-places";
import { DEFAULT_QUERY, type Place } from "@/domain/models";
const cafe = (): Place => ({
  id: "sample-play-cafe",
  name: "Example play café",
  category: "Café",
  area: "Example",
  coordinates: { lat: 51.35, lng: -0.8 },
  environment: "indoor",
  intents: ["kids", "food"],
  company: ["family"],
  duration: [45, 90],
  cost: null,
  costLabel: "Check prices",
  novelty: 0.5,
  daylightOnly: false,
  website: "https://example.org",
  source: "https://www.openstreetmap.org/node/1",
  description: "",
  tagline: "",
  notes: [],
  optionalCategory: "food",
});
const family = {
  ...DEFAULT_QUERY,
  company: "family" as const,
  childrenAges: [3],
};
describe("experience-led classification", () => {
  it("uses verified primary play for a real play cafe without claiming blanket infant suitability", () => {
    const p = normalizeOsmElement({
      type: "node",
      id: 11278417015,
      lat: 51.340175,
      lon: -0.7763774,
      tags: {
        name: "Ruby's Play Cafe",
        amenity: "cafe",
        website: "https://www.therubyplaycafe.co.uk/",
      },
    })!;
    expect(p.category).toBe("Play café");
    expect(optionalCategory(p)).toBeUndefined();
    expect(isMapFoodPlace(p)).toBe(false);
    expect(isSuitableForQuery(p, family)).toBe(true);
    expect(p.experiences?.[0].evidence.source).toBe("official");
    expect(p.evidence?.infantSuitability).toBeUndefined();
    expect(isSuitableForQuery(p, { ...family, childrenAges: [0] })).toBe(false);
    expect(p.notes.join(" ")).toContain("full-paying sibling");
  });

  it.each(["playground:indoor", "playground:soft_play"])(
    "does not promote a pub's incidental %s facility to its primary experience",
    (tag) => {
      const p = normalizeOsmElement({
        type: "node",
        id: 1235,
        lat: 51.35,
        lon: -0.8,
        tags: {
          name: "A pub with play facilities",
          amenity: "pub",
          [tag]: "yes",
        },
      })!;
      expect(optionalCategory(p)).toBe("pubs");
      expect(isSuitableForQuery(p, family)).toBe(false);
    },
  );
  it("keeps evidence-backed primary play on the map and in recommendations when food is off", () => {
    const p = {
      ...cafe(),
      experiences: [
        {
          activities: ["soft-play" as const],
          primary: true,
          evidence: {
            source: "official" as const,
            confidence: "verified" as const,
            url: "https://example.org/play",
          },
        },
      ],
    };
    expect(optionalCategory(p)).toBeUndefined();
    expect(isMapFoodPlace(p)).toBe(false);
    expect(isSuitableForQuery(p, family)).toBe(true);
  });
  it("does not let incidental play or an unsupported venue name bypass the food opt-out", () => {
    const p = {
      ...cafe(),
      name: "Ruby-inspired name is not evidence",
      experiences: [
        {
          activities: ["playground" as const],
          primary: false,
          evidence: {
            source: "osm" as const,
            confidence: "reported" as const,
            url: "https://www.openstreetmap.org/node/1",
          },
        },
      ],
    };
    expect(isSuitableForQuery(p, family)).toBe(false);
    expect(isMapFoodPlace(p)).toBe(true);
  });
  it("keeps mapped indoor play at a café eligible without an ID-specific exception", () => {
    const p = normalizeOsmElement({
      type: "node",
      id: 1234,
      lat: 51.35,
      lon: -0.8,
      tags: {
        name: "An independent play café",
        amenity: "cafe",
        leisure: "indoor_play",
      },
    })!;
    expect(optionalCategory(p)).toBeUndefined();
    expect(isMapFoodPlace(p)).toBe(false);
    expect(isSuitableForQuery(p, family)).toBe(true);
  });
  it("keeps a pub with an incidental playground opt-in", () => {
    const p = {
      ...cafe(),
      category: "Pub",
      optionalCategory: "pubs" as const,
      familyFeatures: ["Playground"],
    };
    expect(isSuitableForQuery(p, family)).toBe(false);
    expect(isMapFoodPlace(p)).toBe(true);
  });
});
