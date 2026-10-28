import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/providers/place-photo", () => ({
  parsePhotoQuery: () => ({
    id: "missing-venue",
    name: "Verified venue",
    lat: 51,
    lng: -1,
    area: "Fleet",
    website: "https://littlelantern.co.uk/fleet/",
  }),
  lookupPlacePhoto: vi.fn(),
}));
vi.mock("@/providers/photo-index", () => ({ indexedPhoto: vi.fn(() => null) }));
vi.mock("@/providers/venue-media", () => ({
  storedQueryImage: () => undefined,
  storedVenueImage: () => undefined,
}));
vi.mock("@/providers/places", () => ({ PLACES: [] }));
vi.mock("@/providers/official-photo", () => ({
  resolveOfficialWebsitePreview: vi.fn(),
}));
vi.mock("@/providers/official-website-discovery", () => ({
  discoverOfficialWebsite: vi.fn(async () => ({
    urls: [],
    status: "disabled",
  })),
}));
import { resolveOfficialWebsitePreview } from "@/providers/official-photo";
import { indexedPhoto } from "@/providers/photo-index";
import { lookupPlacePhoto } from "@/providers/place-photo";
import { GET } from "@/app/api/photo/route";

beforeEach(() => {
  vi.mocked(resolveOfficialWebsitePreview).mockResolvedValue({
    image: null,
    retryable: false,
    result: {
      candidates: [],
      identity: {
        matchedName: false,
        matchedArea: false,
        matchedAddress: false,
        multiBranch: false,
        branchSpecific: false,
        evidence: [],
      },
      rejected: {},
      pageUrl: null,
      reason: "no-venue-photo",
      requestCount: 0,
      retryable: false,
      elapsedMs: 0,
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("returns within the whole 6.5-second deadline even when a resolver hangs", async () => {
  vi.useFakeTimers();
  vi.mocked(lookupPlacePhoto).mockImplementationOnce(
    () => new Promise(() => {}),
  );
  const response = GET(
    new Request("https://sidequest.example/api/photo?name=Venue&lat=51&lng=-1"),
  );
  await vi.advanceTimersByTimeAsync(6500);
  expect(await (await response).json()).toMatchObject({
    image: null,
    retryable: true,
  });
  expect((await response).headers.get("Cache-Control")).toBe(
    "private, no-store",
  );
});

it("does not cache rights-reserved resolver images as approved photography", async () => {
  vi.mocked(lookupPlacePhoto).mockResolvedValueOnce({
    source: "live",
    image: {
      url: "https://venue.example/photo.jpg",
      source: "https://venue.example",
      credit: "Venue",
      license: "Venue website — rights reserved",
      checkedAt: "2026-10-09T00:00:00Z",
    },
  });
  const response = await GET(
    new Request("https://sidequest.example/api/photo?name=Venue&lat=51&lng=-1"),
  );
  expect(await response.json()).toMatchObject({ image: null });
});

it("finds an official preview despite an indexed Commons absence", async () => {
  vi.mocked(indexedPhoto).mockReturnValueOnce({
    query: { name: "Verified venue", lat: 51, lng: -1 },
    checkedAt: new Date().toISOString(),
    image: null,
  });
  const image = {
    url: "https://littlelantern.co.uk/fleet-interior.jpg",
    source: "https://littlelantern.co.uk/fleet/",
    credit: "Verified venue",
    license: "Website preview — rights reserved",
    rights: "website-preview" as const,
    strategy: "official-website-preview",
    checkedAt: new Date().toISOString(),
    preview: {
      pageUrl: "https://littlelantern.co.uk/fleet/",
      publisher: "Verified venue",
      kind: "open-graph" as const,
      identityEvidence: ["venue and area matched"],
      subjectEvidence: ["physical venue scene"],
    },
  };
  vi.mocked(resolveOfficialWebsitePreview).mockResolvedValueOnce({
    image,
    retryable: false,
    result: {
      candidates: [],
      identity: {
        matchedName: true,
        matchedArea: true,
        matchedAddress: false,
        multiBranch: false,
        branchSpecific: true,
        evidence: [],
      },
      rejected: {},
      pageUrl: image.source,
      reason: null,
      requestCount: 1,
      retryable: false,
      elapsedMs: 10,
    },
  });
  const response = await GET(
    new Request("https://sidequest.example/api/photo?name=Venue&lat=51&lng=-1"),
  );
  expect(await response.json()).toMatchObject({
    image: { rights: "website-preview", url: image.url },
  });
});
