import { expect, it } from "vitest";
import {
  indexedPhoto,
  photoIdentity,
  photoIndex,
} from "../src/providers/photo-index";
import { safePhotoUrl } from "../src/providers/place-photo";
const query = { id: "osm-node-12", name: "Branch Park", lat: 51, lng: -1 };
const image = {
  url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Park.jpg",
  source: "https://commons.wikimedia.org/wiki/File:Park.jpg",
  credit: "Author",
  license: "CC BY-SA 2.0",
};
it("ships unique attributed venue photos and numeric diagnostics in the generated index", () => {
  expect(
    new Set(photoIndex.entries.map((entry) => photoIdentity(entry.query))).size,
  ).toBe(photoIndex.entries.length);
  for (const entry of photoIndex.entries) {
    expect(Number.isFinite(Date.parse(entry.checkedAt))).toBe(true);
    for (const value of Object.values(entry.diagnostics?.rejected || {}))
      expect(
        typeof value === "number" && Number.isFinite(value) && value > 0,
      ).toBe(true);
    if (entry.image) {
      expect(safePhotoUrl(entry.image.url)).toBe(true);
      expect(safePhotoUrl(entry.image.source, true)).toBe(true);
      expect(entry.image.credit.trim().length).toBeGreaterThan(0);
      expect(entry.image.license).toMatch(
        /^(?:CC(?:0| BY(?:-SA)?)(?: [0-9.]+)?|Public domain)$/i,
      );
      expect(entry.image.width).toBeGreaterThan(0);
      expect(entry.image.height).toBeGreaterThan(0);
    }
  }
});
it("reuses a generated match only for the same venue name and position", () => {
  const entry = {
    query,
    image,
    checkedAt: new Date().toISOString(),
    retryable: false,
  };
  expect(indexedPhoto(query, [entry])?.image).toEqual({
    ...image,
    rights: "open",
    checkedAt: entry.checkedAt,
  });
  expect(indexedPhoto({ ...query, name: "Other Branch" }, [entry])).toBeNull();
  expect(indexedPhoto({ ...query, lat: 52 }, [entry])).toBeNull();
  expect(photoIdentity(query)).not.toBe(
    photoIdentity({ ...query, commons: "File:Changed.jpg" }),
  );
});
it("never persists a temporary provider failure as a missing venue photo", () => {
  expect(
    indexedPhoto(query, [
      {
        query,
        image: null,
        checkedAt: new Date().toISOString(),
        retryable: true,
      },
    ]),
  ).toBeNull();
  expect(
    indexedPhoto(query, [{ query, image, checkedAt: "2020-01-01T00:00:00Z" }]),
  ).toBeNull();
});
