import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeOsmElement } from "@/providers/nearby-places";

const element = (tags: Record<string, unknown> = {}) => ({
  type: "node",
  id: 123,
  lat: 51.5,
  lon: -0.1,
  tags: { name: "Mapped museum", tourism: "museum", ...tags },
});

afterEach(() => vi.unstubAllGlobals());

describe("OSM media metadata", () => {
  it("retains explicit image and Commons references without fetching or assuming a license", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const place = normalizeOsmElement(
      element({
        image: "File:Museum entrance.jpg",
        wikimedia_commons: "Category:Mapped museum",
        wikidata: "Q123",
        wikipedia: "en:Mapped museum",
      }),
    );
    expect(place).toMatchObject({
      osmImage: "File:Museum entrance.jpg",
      commons: "Category:Mapped museum",
      wikidata: "Q123",
      wikipedia: "en:Mapped museum",
    });
    expect(place?.image).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("canonicalizes Commons page references and bare image filenames", () => {
    expect(
      normalizeOsmElement(
        element({
          image: "Museum entrance.jpg",
          wikimedia_commons:
            "https://commons.wikimedia.org/wiki/File:Museum_entrance.jpg?uselang=en#summary",
        }),
      ),
    ).toMatchObject({
      osmImage: "File:Museum entrance.jpg",
      commons: "File:Museum entrance.jpg",
    });
    expect(
      normalizeOsmElement(
        element({
          wikimedia_commons:
            "https://commons.wikimedia.org/wiki/Category:Museum_%26_gardens",
        }),
      )?.commons,
    ).toBe("Category:Museum & gardens");
  });

  it("preserves legitimate external image URLs only as metadata", () => {
    const place = normalizeOsmElement(
      element({ image: "https://venue.example/photo.jpg" }),
    );
    expect(place?.osmImage).toBe("https://venue.example/photo.jpg");
    expect(place?.image).toBeUndefined();
  });

  it("rejects unsafe, malformed or excessive media references", () => {
    for (const image of [
      "javascript:alert(1)",
      "data:image/png;base64,eA==",
      "//example.org/photo.jpg",
      "https://user:pass@example.org/photo.jpg",
      "https://example.org/ph\noto.jpg",
      "https://example.org/photo%00.jpg",
      "File:Broken\u0000.jpg",
      "File:" + "x".repeat(2048),
    ])
      expect(normalizeOsmElement(element({ image }))?.osmImage).toBeUndefined();
    for (const wikimedia_commons of [
      "https://commons.wikimedia.org.evil.example/wiki/File:Museum.jpg",
      "https://user:pass@commons.wikimedia.org/wiki/File:Museum.jpg",
      "https://example.org/wiki/File:Museum.jpg",
      "https://commons.wikimedia.org/wiki/Main_Page",
      "File:",
      "Category:",
      "File:Museum\n.jpg",
      "File:" + "x".repeat(2048),
    ])
      expect(
        normalizeOsmElement(element({ wikimedia_commons }))?.commons,
      ).toBeUndefined();
  });

  it("retains bounded mapped aliases as name context", () => {
    expect(
      normalizeOsmElement(
        element({
          "name:en": "English museum",
          alt_name: "Other museum;Mapped museum;English museum",
          old_name: "Old museum;Other museum",
        }),
      )?.aliases,
    ).toEqual(["English museum", "Other museum", "Old museum"]);
    const aliases = normalizeOsmElement(
      element({
        alt_name: Array.from({ length: 20 }, (_, i) => `Alias ${i}`).join(";"),
        old_name: "x".repeat(201),
      }),
    )?.aliases;
    expect(aliases).toHaveLength(12);
    expect(aliases?.every((alias) => alias.length <= 200)).toBe(true);
  });

  it("does not change recommendation or eligibility fields when media metadata is present", () => {
    const plain = normalizeOsmElement(element())!;
    const withMedia = normalizeOsmElement(
      element({
        image: "File:Museum.jpg",
        wikimedia_commons: "Category:Mapped museum",
        alt_name: "Old museum",
      }),
    )!;
    const { osmImage, commons, aliases, ...unchanged } = withMedia;
    expect({ osmImage, commons, aliases }).toMatchObject({
      osmImage: "File:Museum.jpg",
    });
    expect(unchanged).toEqual(plain);
  });
});

it("retains media and alternate name tags in the regional extract importer", () => {
  // Read the retention configuration without importing optional osmium or downloading extracts.
  const script = readFileSync("scripts/import-osm-extract.py", "utf8");
  const assignment = /^KEYS\s*=\s*\{([^}]+)\}/m.exec(script)?.[1] ?? "";
  const keys = Array.from(
    assignment.matchAll(/"([^"]+)"/g),
    (match) => match[1],
  );
  expect(keys).toEqual(
    expect.arrayContaining([
      "image",
      "wikimedia_commons",
      "alt_name",
      "old_name",
      "name:en",
      "wikidata",
      "wikipedia",
    ]),
  );
});
