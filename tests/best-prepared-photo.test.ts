import { describe, expect, it } from "vitest";
import { selectPreparedPhoto } from "@/providers/photo-selection";
import type { Place } from "@/domain/models";
const image = (width = 500, confidence = 0.9): NonNullable<Place["image"]> => ({
  url: "/images/example.webp",
  source: "https://commons.wikimedia.org/wiki/File:Example.jpg",
  license: "CC BY-SA 2.0",
  credit: "Example photographer",
  checkedAt: "2026-10-26",
  width,
  height: width * 0.625,
  confidence,
});
describe("prepared photo selection", () => {
  it("uses the prepared card rendition of the same original rather than fetching it again", () => {
    const original = {
      ...image(4000),
      url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.jpg",
    };
    const prepared = image(1280);
    expect(selectPreparedPhoto([prepared, original])?.url).toBe(prepared.url);
  });
  it("chooses a better landscape candidate instead of the first approved photo", () => {
    const small = image(),
      large = { ...image(1800), url: "/images/better.webp" };
    expect(selectPreparedPhoto([small, large])).toEqual({
      ...large,
      rights: "open",
    });
  });
  it("keeps stronger subject identity ahead of a much larger uncertain image", () => {
    const exact = image(800, 0.98),
      uncertain = { ...image(4000, 0.7), url: "/images/uncertain.webp" };
    expect(selectPreparedPhoto([uncertain, exact])?.url).toBe(exact.url);
  });
  it("excludes an excellent image without reusable rights", () => {
    const reserved = {
      ...image(2400),
      license: "Venue website — rights reserved",
    };
    expect(selectPreparedPhoto([reserved])).toBeUndefined();
  });
});
