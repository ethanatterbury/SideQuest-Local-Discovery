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
  vi.mocked(indexedPhoto).mockReset().mockReturnValue(null);
  vi.mocked(lookupPlacePhoto)
    .mockReset()
    .mockResolvedValue({ image: null, source: "unavailable" });
  vi.mocked(resolveOfficialWebsitePreview).mockReset();
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
it("returns a verified reusable photo without waiting for a stalled publisher", async () => {
  vi.useFakeTimers();
  const image = {
    url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Venue.jpg",
    source: "https://commons.wikimedia.org/wiki/File:Venue.jpg",
    credit: "Author",
    license: "CC0",
    checkedAt: "2026-10-30",
  };
  vi.mocked(resolveOfficialWebsitePreview).mockImplementationOnce(
    () => new Promise(() => {}),
  );
  vi.mocked(lookupPlacePhoto).mockImplementationOnce(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { image, source: "live" };
  });
  let result: { image?: unknown } | undefined;
  const request = GET(
    new Request("https://sidequest.example/api/photo?name=Venue&lat=51&lng=-1"),
  );
  void request.then(async (response) => {
    result = await response.json();
  });
  await vi.advanceTimersByTimeAsync(200);
  expect(result).toMatchObject({ image: { url: image.url } });
});
it("cancels unused reusable work when an approved publisher photograph wins", async () => {
  const image = {
    url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Publisher.jpg",
    source: "https://commons.wikimedia.org/wiki/File:Publisher.jpg",
    credit: "Author",
    license: "CC0",
    checkedAt: "2026-10-30",
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
      pageUrl: "https://littlelantern.co.uk/fleet/",
      reason: null,
      requestCount: 1,
      retryable: false,
      elapsedMs: 0,
    },
  });
  let signal: AbortSignal | undefined;
  vi.mocked(lookupPlacePhoto).mockImplementationOnce(
    async (_query, options) => {
      signal = options?.signal;
      return new Promise(() => {});
    },
  );
  const response = await GET(
    new Request("https://sidequest.example/api/photo?name=Venue&lat=51&lng=-1"),
  );
  expect(await response.json()).toMatchObject({ image: { url: image.url } });
  expect(signal?.aborted).toBe(true);
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

it("preserves official website rejection evidence when reusable-source lookup also fails", async () => {
  vi.mocked(resolveOfficialWebsitePreview).mockResolvedValueOnce({
    image: null,
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
      rejected: { "branding-map-or-stock": 1 },
      pageUrl: "https://littlelantern.co.uk/fleet/",
      reason: "no-venue-photo",
      requestCount: 1,
      retryable: false,
      elapsedMs: 20,
    },
  });
  vi.mocked(lookupPlacePhoto).mockResolvedValueOnce({
    image: null,
    source: "unavailable",
  });
  const response = await GET(
    new Request(
      "https://sidequest.example/api/photo?name=Venue&lat=51&lng=-1&debug=1",
    ),
  );
  expect(await response.json()).toMatchObject({
    image: null,
    diagnostics: {
      officialWebsite: {
        attempts: [
          {
            reason: "no-venue-photo",
            rejected: { "branding-map-or-stock": 1 },
          },
        ],
      },
    },
  });
});
