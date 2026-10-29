import { expect, test } from "vitest";
import {
  photoDeliveryChecks,
  photoDeliveryUrlMatches,
  photoNeedsDelivery,
} from "../scripts/lib/photo-delivery-selection.mjs";

const image = {
  url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Local_Park.jpg",
  source: "https://commons.wikimedia.org/wiki/File:Local_Park.jpg",
  credit: "Local photographer",
  license: "CC BY-SA 2.0",
  rights: "open",
  strategy: "geograph-commons-source-id",
  checkedAt: "2026-10-28T00:00:00.000Z",
};
const entry = {
  query: { id: "osm-node-123", name: "Local Park", lat: 51.3, lng: -0.8 },
  image,
  checkedAt: image.checkedAt,
};
const manifest = (entries: unknown[]) => ({ version: 1, entries });
const now = Date.parse("2026-10-28T00:00:00.000Z");

test("new approved Geograph Commons photos require real delivery evidence", () => {
  expect(photoNeedsDelivery(entry)).toBe(true);
  expect(
    photoDeliveryChecks({
      before: manifest([]),
      after: manifest([entry]),
      now,
    }),
  ).toEqual([{ entry, screenshot: true }]);
});

test("unchanged Geograph delivery proof lasts thirty days without being renewed by a metadata refresh", () => {
  const prior = { ...entry, deliveryVerifiedAt: "2026-10-01T00:00:00.000Z" };
  expect(
    photoDeliveryChecks({
      before: manifest([prior]),
      after: manifest([entry]),
      now,
    }),
  ).toEqual([]);
  expect(
    photoDeliveryChecks({
      before: manifest([prior]),
      after: manifest([entry]),
      now: Date.parse("2026-10-31T00:00:00.000Z"),
    }),
  ).toHaveLength(1);
});

test.each([
  { ...image, url: `${image.url}?new=1` },
  { ...image, source: "https://commons.wikimedia.org/wiki/File:Updated.jpg" },
  { ...image, credit: "Corrected photographer" },
  { ...image, license: "CC BY 2.0" },
])(
  "Geograph URL, source and attribution changes require new browser proof %j",
  (replacement) => {
    const prior = { ...entry, deliveryVerifiedAt: "2026-10-01T00:00:00.000Z" };
    expect(
      photoDeliveryChecks({
        before: manifest([prior]),
        after: manifest([{ ...entry, image: replacement }]),
        now,
      }),
    ).toHaveLength(1);
  },
);

test.each([
  { ...image, license: "All rights reserved" },
  { ...image, source: "https://unrelated.example.com/park" },
  { ...image, credit: "" },
  { ...image, strategy: "commons-search" },
])(
  "the new gate excludes unapproved or unrelated open photo records %j",
  (replacement) => {
    const candidate = { ...entry, image: replacement };
    expect(photoNeedsDelivery(candidate)).toBe(false);
    expect(
      photoDeliveryChecks({
        before: manifest([]),
        after: manifest([candidate]),
        now,
      }),
    ).toEqual([]);
  },
);

test("the delivery URL matcher accepts only the exact source inside the same-origin Next image optimizer", () => {
  const page = "https://sidequest.example.com/place/osm-node-123";
  const optimized = `/_next/image?url=${encodeURIComponent(image.url)}&w=1920&q=75`;
  expect(photoDeliveryUrlMatches(image.url, image, page)).toBe(true);
  expect(photoDeliveryUrlMatches(optimized, image, page)).toBe(true);
  expect(
    photoDeliveryUrlMatches(
      `https://sidequest.example.com${optimized}`,
      image,
      page,
    ),
  ).toBe(true);
  expect(
    photoDeliveryUrlMatches(
      `https://other.example.com${optimized}`,
      image,
      page,
    ),
  ).toBe(false);
  expect(
    photoDeliveryUrlMatches(
      optimized.replace("Local_Park", "Different_Park"),
      image,
      page,
    ),
  ).toBe(false);
  expect(
    photoDeliveryUrlMatches(
      optimized.replace("/_next/image", "/proxy"),
      image,
      page,
    ),
  ).toBe(false);
  expect(photoDeliveryUrlMatches("invalid", image, page)).toBe(false);
  expect(
    photoDeliveryUrlMatches(
      optimized,
      { ...image, rights: "website-preview" },
      page,
    ),
  ).toBe(false);
});
