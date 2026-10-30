import { describe, expect, it } from "vitest";
import { DEFAULT_QUERY, type Place } from "@/domain/models";
import { isSuitableForQuery } from "@/domain/venue-suitability";
import { normalizeOsmElement } from "@/providers/nearby-places";

const family = { ...DEFAULT_QUERY, company: "family" as const };
function venue(category: string, extra: Partial<Place> = {}): Place {
  return {
    ...normalizeOsmElement({
      type: "node",
      id: 123,
      lat: 51.5,
      lon: -0.1,
      tags: { name: "Fixture attraction", tourism: "theme_park" },
    })!,
    category,
    suitability: undefined,
    ...extra,
  };
}

describe("whole attraction visits and activity eligibility", () => {
  it.each([undefined, [], [7], [0]])(
    "keeps a whole theme park visit discoverable with ages %j",
    (childrenAges) => {
      expect(
        isSuitableForQuery(venue("Theme park"), { ...family, childrenAges }),
      ).toBe(true);
    },
  );
  it("does not let an old ride classification suppress a whole park", () => {
    const place = venue("Theme park", {
      suitability: {
        kind: "adventure",
        activities: [],
        audience: "all",
        ageGuidance: "unknown",
        requiresAgeCheck: true,
        source: "osm",
      },
    });
    expect(isSuitableForQuery(place, family)).toBe(true);
  });
  it.each(["Amusement ride", "Bowling alley"])(
    "keeps child eligibility checks for %s",
    (category) => {
      const place = venue(category);
      for (const childrenAges of [undefined, [7], [0]])
        expect(isSuitableForQuery(place, { ...family, childrenAges })).toBe(
          false,
        );
      expect(
        isSuitableForQuery(
          { ...place, ageRange: [4, 17] },
          { ...family, childrenAges: [7] },
        ),
      ).toBe(true);
      expect(
        isSuitableForQuery(
          { ...place, ageRange: [0, 17] },
          { ...family, childrenAges: [0] },
        ),
      ).toBe(false);
    },
  );
  it("preserves park admission limits, height restrictions and strict suitability", () => {
    expect(
      isSuitableForQuery(venue("Theme park", { ageRange: [4, 17] }), {
        ...family,
        childrenAges: [3],
      }),
    ).toBe(false);
    expect(
      isSuitableForQuery(venue("Theme park", { ageRange: [4, 17] }), {
        ...family,
        childrenAges: [7],
      }),
    ).toBe(true);
    expect(
      isSuitableForQuery(
        venue("Theme park", { heightRange: [120, null] }),
        family,
      ),
    ).toBe(false);
    expect(
      isSuitableForQuery(venue("Theme park"), {
        ...family,
        childrenAges: [7],
        strictSuitability: true,
      }),
    ).toBe(false);
  });
  it("does not infer infant participation from the park's incidental play", () => {
    expect(
      isSuitableForQuery(
        venue("Theme park", { familyFeatures: ["Playground"] }),
        { ...family, childrenAges: [0] },
      ),
    ).toBe(true);
    expect(
      isSuitableForQuery(
        venue("Theme park", { familyFeatures: ["Playground"] }),
        { ...family, childrenAges: [0], activity: "playground" },
      ),
    ).toBe(false);
  });
});
