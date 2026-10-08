import { describe, expect, it } from "vitest";
import { isMapFoodPlace } from "../src/features/map/map-food";

describe("Map food venue classification", () => {
  it.each([
    "Café",
    "Cafés",
    "Coffee shop",
    "Restaurant",
    "Ice-cream shop",
    "Tea room",
    "Pub",
    "Bars",
    "Bakery",
    "Food market",
  ])("recognizes %s as a food venue", (category) => {
    expect(isMapFoodPlace({ category })).toBe(true);
  });
  it.each(["Arts centre & grounds", "Museum", "Gardens & parks", "Soft play"])(
    "preserves %s outings even if food is an incidental intent",
    (category) => {
      expect(isMapFoodPlace({ category, intents: ["food", "culture"] })).toBe(
        false,
      );
    },
  );
});
