import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/providers/place-photo", () => ({
  parsePhotoQuery: () => ({
    id: "missing-venue",
    name: "Verified venue",
    lat: 51,
    lng: -1,
  }),
  lookupPlacePhoto: vi.fn(),
}));
vi.mock("@/providers/photo-index", () => ({ indexedPhoto: () => null }));
vi.mock("@/providers/venue-media", () => ({
  storedQueryImage: () => undefined,
  storedVenueImage: () => undefined,
}));
vi.mock("@/providers/places", () => ({ PLACES: [] }));
import { lookupPlacePhoto } from "@/providers/place-photo";
import { GET } from "@/app/api/photo/route";

afterEach(() => vi.useRealTimers());

it("returns within the whole 4.5-second deadline even when a resolver hangs", async () => {
  vi.useFakeTimers();
  vi.mocked(lookupPlacePhoto).mockImplementationOnce(
    () => new Promise(() => {}),
  );
  const response = GET(
    new Request("https://sidequest.example/api/photo?name=Venue&lat=51&lng=-1"),
  );
  await vi.advanceTimersByTimeAsync(4500);
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
