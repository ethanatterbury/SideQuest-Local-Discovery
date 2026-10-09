import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import media from "@/providers/data/venue-media.json";
import { storedVenueImage, withStoredPhoto } from "@/providers/venue-media";
import { approvedPhoto } from "@/providers/photo-policy";
import { PLACES } from "@/providers/places";
import snapshot from "@/providers/data/regional-osm.json";
import { normalizeOsmElement } from "@/providers/nearby-places";

const approved = media.entries.filter((entry) =>
  approvedPhoto(entry.image, media.generatedAt),
);
const catalogue = [
  ...PLACES,
  ...snapshot.elements.map(normalizeOsmElement).filter((place) => !!place),
];

describe("prepared venue photography", () => {
  it("delivers the venue photograph in catalogue data before rendering a card", () => {
    const entry = approved.find((entry) => entry.id.startsWith("osm-"))!;
    const place = catalogue.find((place) => place!.id === entry.id)!;
    expect(withStoredPhoto(place).image?.url).toBe(entry.image.url);
    expect(
      storedVenueImage({
        ...place,
        name: "A different venue",
        image: undefined,
      })?.url,
    ).not.toBe(entry.image.url);
    expect(
      storedVenueImage({
        ...place,
        coordinates: { lat: 0, lng: 0 },
        image: undefined,
      })?.url,
    ).not.toBe(entry.image.url);
  });

  it("ships a decodable, correctly sized local photograph for every approved stored media record", async () => {
    expect(new Set(media.entries.map((entry) => entry.id)).size).toBe(
      media.entries.length,
    );
    await Promise.all(
      approved.map(async (entry) => {
        const place = catalogue.find((place) => place!.id === entry.id)!;
        expect(place, entry.id).toBeDefined();
        expect(
          storedVenueImage({ ...place, image: undefined })?.url,
          entry.id,
        ).toBe(entry.image.url);
        expect(entry.image.url).toMatch(
          /^\/venue-images\/[a-z0-9-]+-[a-f0-9]{12,16}\.webp$/,
        );
        const file = await readFile(
          new URL(`../public${entry.image.url}`, import.meta.url),
        );
        const decoded = await sharp(file).metadata();
        expect(decoded.format).toBe("webp");
        expect(decoded.width).toBe(entry.image.width);
        expect(decoded.height).toBe(entry.image.height);
        const blur = await sharp(
          Buffer.from(entry.image.blurDataURL.split(",")[1], "base64"),
        ).metadata();
        expect(blur.width).toBeLessThanOrEqual(20);
        expect(entry.image.source).toMatch(/^https:\/\//);
        expect(entry.image.credit.length).toBeGreaterThan(0);
        expect(entry.image.license.length).toBeGreaterThan(0);
      }),
    );
  });
});

it("excludes rights-reserved prepared photos even when they have attribution", () => {
  const entry = media.entries.find((row) =>
    /rights reserved/.test(row.image.license),
  )!;
  const place = catalogue.find((row) => row.id === entry.id)!;
  expect(storedVenueImage({ ...place, image: undefined })?.url).not.toBe(
    entry.image.url,
  );
});
