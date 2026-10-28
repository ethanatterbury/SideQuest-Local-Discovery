import { expect, it } from "vitest";
import {
  preparedVenuePhotos,
  preparedVenuePhoto,
  preparedWebsiteCandidates,
  websiteDiscoveryIdentity,
} from "../src/providers/prepared-venue-photos";
import { indexedPhoto } from "../src/providers/photo-index";
const query = {
  id: "osm-node-123",
  name: "Little Lantern Play",
  lat: 51.28,
  lng: -0.84,
  area: "Fleet",
};
const checkedAt = new Date().toISOString();
const url = "https://littlelantern.co.uk/play-interior.jpg";
const source = "https://littlelantern.co.uk/fleet/";
const image = {
  url,
  source,
  credit: query.name,
  license: "Website preview — rights reserved",
  rights: "website-preview" as const,
  strategy: "official-website-preview",
  checkedAt,
  preview: {
    kind: "venue-image" as const,
    pageUrl: source,
    publisher: query.name,
    identityEvidence: ["name and Fleet address matched"],
    subjectEvidence: ["physical venue scene verified by visual review"],
    review: {
      method: "visual-review" as const,
      imageUrl: url,
      checkedAt,
      description:
        "A wide view of the enclosed role-play rooms and parent seating.",
    },
  },
};
const entry = {
  query,
  checkedAt,
  image,
  retryable: false,
  website: {
    urls: [source],
    status: "found" as const,
    source: "mapped" as const,
  },
  status: "matched",
};
it("returns a prepared external photo without network lookup", () => {
  expect(preparedVenuePhoto(query, [entry])?.url).toBe(url);
});
it("does not reuse a photo for another identity or relocated venue", () => {
  expect(
    preparedVenuePhoto({ ...query, id: "osm-node-124" }, [entry]),
  ).toBeUndefined();
  expect(
    preparedVenuePhoto({ ...query, name: "Other name" }, [entry]),
  ).toBeUndefined();
  expect(preparedVenuePhoto({ ...query, lat: 52 }, [entry])).toBeUndefined();
});
it("reuses source links when only area/address metadata improves", () => {
  expect(
    preparedWebsiteCandidates(
      { ...query, area: "Fleet, Hampshire", address: "High Street" },
      [entry],
    ),
  ).toEqual({ status: "found", urls: [source] });
});
it("rejects fake visual review that describes a different image", () => {
  const bad = {
    ...entry,
    image: {
      ...image,
      preview: {
        ...image.preview,
        review: {
          ...image.preview.review,
          imageUrl: "https://littlelantern.co.uk/other.jpg",
        },
      },
    },
  };
  expect(preparedVenuePhoto(query, [bad])).toBeUndefined();
});
it("does not return transient failures or expired search attempts as durable website misses", () => {
  const unavailable = {
    ...entry,
    image: null,
    website: {
      urls: [],
      status: "unavailable" as const,
      source: "tavily" as const,
      searchedAt: checkedAt,
      searchExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    },
  };
  expect(preparedWebsiteCandidates(query, [unavailable])).toBeUndefined();
  const expired = {
    ...entry,
    website: {
      ...entry.website,
      source: "tavily" as const,
      searchedAt: "2020-01-01",
      searchExpiresAt: "2020-02-01",
    },
  };
  expect(preparedWebsiteCandidates(query, [expired])).toBeUndefined();
});

it("keeps image-analysis evidence distinct from a personal visual review", () => {
  const analysed = {
    ...entry,
    image: {
      ...image,
      confidence: 0.85,
      preview: {
        ...image.preview,
        subjectEvidence: [
          "physical venue scene described by external image analysis",
        ],
        review: {
          ...image.preview.review,
          method: "image-analysis:web-image-search" as const,
        },
      },
    },
  };
  expect(preparedVenuePhoto(query, [analysed])?.preview?.review?.method).toBe(
    "image-analysis:web-image-search",
  );
});

it("rejects an invalid search expiry rather than treating it as unlimited", () => {
  expect(
    preparedWebsiteCandidates(query, [
      {
        ...entry,
        website: {
          ...entry.website,
          source: "tavily",
          searchedAt: checkedAt,
          searchExpiresAt: "invalid",
        },
      },
    ]),
  ).toBeUndefined();
});

it("does not relabel external analysis as a personal inspection", () => {
  expect(
    preparedVenuePhoto(query, [
      {
        ...entry,
        image: {
          ...image,
          preview: {
            ...image.preview,
            review: {
              ...image.preview.review,
              method: "image-analysis:web-image-search",
            },
          },
        },
      },
    ]),
  ).toBeUndefined();
});

it("ships unique approved prepared photos through the normal catalogue index", () => {
  const positives = preparedVenuePhotos.entries.filter((entry) => entry.image);
  expect(positives.length).toBeGreaterThan(0);
  expect(
    new Set(
      preparedVenuePhotos.entries.map((entry) =>
        websiteDiscoveryIdentity(entry.query),
      ),
    ).size,
  ).toBe(preparedVenuePhotos.entries.length);
  for (const entry of positives) {
    const photo = preparedVenuePhoto(entry.query);
    expect(photo, entry.query.name).toBeDefined();
    expect(indexedPhoto(entry.query)?.image?.url).toBe(photo?.url);
    expect(photo?.url).toMatch(/^https:\/\//);
    expect(photo?.source).toBe(photo?.preview?.pageUrl);
  }
});
