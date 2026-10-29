import { describe, expect, it } from "vitest";
import type { Place } from "@/domain/models";
import { selectPreparedPhoto } from "@/providers/photo-selection";
import {
  approvedPhoto,
  LOCAL_PHOTO_REVIEW_GROUPS,
  LOCAL_PHOTO_REVIEW_MODEL,
  LOCAL_PHOTO_REVIEW_THRESHOLD,
} from "@/providers/photo-policy";
import prepared from "@/providers/data/venue-photo-previews.json";

type Image = NonNullable<Place["image"]>;
const assertions = [
  "exact-geograph-source-id",
  "full venue name in Geograph subject title",
  "precise Geograph subject position within 150m",
];
function image(file: string, extra: Partial<Image> = {}): Image {
  return {
    url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${file}`,
    source: `https://commons.wikimedia.org/wiki/File:${file}`,
    credit: "Photographer",
    license: "CC BY-SA 2.0",
    checkedAt: "2026-10-29",
    width: 960,
    height: 640,
    confidence: 0.9,
    strategy: "commons-search",
    ...extra,
  };
}
const proven = (extra: Partial<Image> = {}) =>
  image("Venue.jpg", {
    strategy: "geograph-commons-source-id",
    matched: [...assertions],
    ...extra,
  });
function official(): Image {
  const url = "https://museum.org.uk/photos/interior.jpg";
  return {
    url,
    source: "https://museum.org.uk/visit/",
    credit: "Example Museum",
    license: "Website preview — rights reserved",
    rights: "website-preview",
    strategy: "official-website-preview",
    checkedAt: "2026-10-29",
    width: 2400,
    height: 1600,
    confidence: 0.9,
    preview: {
      pageUrl: "https://museum.org.uk/visit/",
      publisher: "Example Museum",
      kind: "venue-image",
      identityEvidence: [
        "venue name in page title, heading or business schema",
        "venue area in page metadata, path or business address",
      ],
      subjectEvidence: ["physical venue scene verified by visual review"],
      review: {
        method: "visual-review",
        imageUrl: url,
        description:
          "The museum interior shows its gallery and visitor exhibits.",
        checkedAt: "2026-10-29",
      },
    },
  };
}
function locallyReviewed(): Image {
  const photo = official();
  photo.preview!.subjectEvidence = [
    "physical venue scene classified by local model",
  ];
  photo.preview!.review = {
    ...photo.preview!.review!,
    method: "image-analysis:local-clip",
    sha256: "a".repeat(64),
    localClip: {
      model: { ...LOCAL_PHOTO_REVIEW_MODEL },
      ...LOCAL_PHOTO_REVIEW_THRESHOLD,
      bestVenueScore: 0.9,
      bestRejectScore: 0.0125,
      margin: 0.8875,
      scores: Object.entries(LOCAL_PHOTO_REVIEW_GROUPS).map(([id, group]) => ({
        id,
        group,
        score: id === "venue-interior" ? 0.9 : 0.0125,
      })),
    },
  };
  return photo;
}
const manualPreviews = (
  prepared as unknown as {
    entries: { query: { name: string }; image: Image | null }[];
  }
).entries.filter(
  ({ image }) =>
    image?.rights === "website-preview" &&
    ["visual-review", "image-analysis:web-image-search"].includes(
      image.preview?.review?.method ?? "",
    ),
);

describe("prepared original photo provenance", () => {
  it("exercises the existing manually reviewed manifest records", () => {
    expect(manualPreviews.length).toBeGreaterThan(0);
  });
  it.each(manualPreviews)(
    "retains approved descriptive manual identity evidence for $query.name",
    ({ image: reviewed }) => {
      expect(approvedPhoto(reviewed)).toBeDefined();
      const geograph = proven({ confidence: 0.4, width: 4000, height: 2500 });
      expect(selectPreparedPhoto([geograph, reviewed])?.url).toBe(
        reviewed!.url,
      );
    },
  );

  it("retains the complete reviewed contract when another rendition of the same URL is larger", () => {
    const reviewed = official();
    reviewed.width = 960;
    reviewed.height = 640;
    const unreviewed = official();
    unreviewed.preview!.kind = "open-graph";
    delete unreviewed.preview!.review;
    unreviewed.width = 4000;
    unreviewed.height = 2500;
    unreviewed.confidence = 0.7;
    for (const candidates of [
      [reviewed, unreviewed],
      [unreviewed, reviewed],
    ]) {
      const selected = selectPreparedPhoto(candidates);
      expect(selected?.preview).toEqual(reviewed.preview);
      expect(selected?.width).toBe(unreviewed.width);
      expect(approvedPhoto(selected)).toBeDefined();
    }
  });

  it("uses corrected same-original attribution and license with local delivery", () => {
    const local = image("Venue_photo.jpg", {
      url: "/images/local.webp",
      width: 1280,
      height: 800,
      credit: "Old credit",
      license: "CC BY 2.0",
    });
    const reviewed = proven({
      source: "https://commons.wikimedia.org/wiki/File:Venue%20photo.jpg",
      credit: "Corrected photographer",
      license: "CC BY-SA 4.0",
    });
    expect(selectPreparedPhoto([local, reviewed])).toMatchObject({
      url: local.url,
      source: reviewed.source,
      credit: reviewed.credit,
      license: reviewed.license,
      width: local.width,
    });
  });

  it.each([
    "venue area in page metadata, path or business address",
    "venue address matched",
    "venue coordinates matched",
  ])(
    "lets a reviewed official interior compete with Geograph using %s",
    (location) => {
      const interior = official();
      interior.preview!.identityEvidence[1] = location;
      const geograph = proven();
      for (const candidates of [
        [geograph, interior],
        [interior, geograph],
      ])
        expect(selectPreparedPhoto(candidates)?.url).toBe(interior.url);
    },
  );

  it("retains confidence precedence between proven official and Geograph photos", () => {
    const interior = {
      ...official(),
      confidence: 0.98,
      width: 800,
      height: 500,
    };
    const uncertain = proven({ confidence: 0.7, width: 4000, height: 2500 });
    expect(selectPreparedPhoto([uncertain, interior])?.url).toBe(interior.url);
    expect(
      selectPreparedPhoto([
        { ...interior, confidence: 0.7 },
        { ...uncertain, confidence: 0.98 },
      ])?.url,
    ).toBe(uncertain.url);
  });

  it.each(["review", "scene"] as const)(
    "does not promote an official preview missing %s evidence",
    (missing) => {
      const preview = official();
      if (missing === "review") {
        delete preview.preview!.review;
        preview.preview!.kind = "open-graph";
        preview.preview!.subjectEvidence = [
          "physical venue scene in image metadata",
        ];
      }
      if (missing === "scene") {
        preview.preview!.kind = "open-graph";
        preview.preview!.subjectEvidence = ["page image metadata"];
      }
      expect(approvedPhoto(preview)).toBeDefined();
      expect(selectPreparedPhoto([preview, proven()])?.url).toBe(proven().url);
    },
  );

  it("accepts fully validated local-model reviews", () => {
    const reviewed = locallyReviewed();
    expect(approvedPhoto(reviewed)).toBeDefined();
    expect(selectPreparedPhoto([reviewed, proven()])?.url).toBe(reviewed.url);
  });
  it.each(["name", "location"] as const)(
    "keeps exact %s identity evidence required for local-model review",
    (missing) => {
      const reviewed = locallyReviewed();
      if (missing === "name") reviewed.preview!.identityEvidence.shift();
      else reviewed.preview!.identityEvidence.pop();
      expect(approvedPhoto(reviewed)).toBeUndefined();
      expect(selectPreparedPhoto([reviewed, proven()])?.url).toBe(proven().url);
    },
  );

  it("keeps different official photographs on the same publisher page separate", () => {
    const large = official();
    const small = {
      ...official(),
      url: "https://museum.org.uk/photos/exterior.jpg",
      width: 960,
      height: 640,
      confidence: 0.95,
    };
    small.preview = {
      ...small.preview!,
      review: { ...small.preview!.review!, imageUrl: small.url },
    };
    expect(selectPreparedPhoto([small, large])).toEqual(large);
  });

  it.each([0.9, 1])(
    "prefers a fully proven original over a larger legacy photo with confidence %s",
    (confidence) => {
      const legacy = image("Venue_car_park.jpg", {
        width: 2048,
        height: 1536,
        confidence,
      });
      const reviewed = proven();
      for (const candidates of [
        [legacy, reviewed],
        [reviewed, legacy],
      ])
        expect(selectPreparedPhoto(candidates)?.url).toBe(reviewed.url);
    },
  );

  it.each([
    [],
    ...assertions.map((missing) => assertions.filter((a) => a !== missing)),
  ])(
    "requires every source assertion instead of trusting the strategy label: %j",
    (...matched) => {
      const incomplete = proven({ matched });
      const legacy = image("Other.jpg", { width: 2400, height: 1600 });
      expect(selectPreparedPhoto([incomplete, legacy])?.url).toBe(legacy.url);
    },
  );

  it("requires the exact prepared strategy as well as all assertions", () => {
    const unproven = proven({ strategy: "commons-search" });
    const legacy = image("Other.jpg", { width: 2400, height: 1600 });
    expect(selectPreparedPhoto([unproven, legacy])?.url).toBe(legacy.url);
  });

  it("keeps a usable local rendition with the strongest same-file provenance", () => {
    const local = image("Venue_photo.jpg", {
      url: "/venue-images/example-123456abcdef.webp",
      width: 1280,
      height: 800,
      confidence: 0.7,
      blurDataURL: "data:image/webp;base64,example",
    });
    const reviewed = proven({
      source: "https://commons.wikimedia.org/wiki/File:Venue%20photo.jpg",
      width: 4000,
      height: 2500,
    });
    const legacy = image("Other.jpg", {
      width: 2400,
      height: 1600,
      confidence: 1,
    });
    const selected = selectPreparedPhoto([legacy, local, reviewed]);
    expect(selected).toMatchObject({
      url: local.url,
      source: reviewed.source,
      width: local.width,
      height: local.height,
      blurDataURL: local.blurDataURL,
      confidence: reviewed.confidence,
      strategy: reviewed.strategy,
      matched: assertions,
      rights: "open",
    });
  });

  it("does not reuse a local rendition for a filename differing in case", () => {
    const local = image("Venue.jpg", {
      url: "/images/local.webp",
      width: 1280,
      height: 800,
    });
    const different = image("venue.jpg", { width: 4000, height: 2500 });
    expect(selectPreparedPhoto([local, different])?.url).toBe(different.url);
  });

  it("retains the existing minimum local rendition size", () => {
    const local = image("Venue.jpg", {
      url: "/images/small.webp",
      width: 500,
      height: 320,
    });
    const reviewed = proven({ width: 2400, height: 1600 });
    expect(selectPreparedPhoto([local, reviewed])?.url).toBe(reviewed.url);
  });

  it("does not let provenance bypass rights checks or transfer from a rejected image", () => {
    const rejected = proven({ license: "All rights reserved" });
    const local = image("Venue.jpg", { url: "/images/local.webp" });
    const legacy = image("Other.jpg", { width: 2400, height: 1600 });
    expect(selectPreparedPhoto([rejected])).toBeUndefined();
    expect(selectPreparedPhoto([local, rejected, legacy])?.url).toBe(
      legacy.url,
    );
  });
});
