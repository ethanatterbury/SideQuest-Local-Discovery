import { expect, it, vi, afterEach } from "vitest";
import { findPlacePhoto, photoRetryDelay } from "../src/providers/photo-client";
import { PLACES } from "../src/providers/places";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("sends imported media hints and retries a temporary failure instead of recording a permanent absence", async () => {
  vi.useFakeTimers();
  const place = {
    ...PLACES[0],
    id: "retry-test",
    image: undefined,
    commons: "Category:Venue",
    osmImage: "File:Venue.jpg",
    aliases: ["Other venue name"],
  };
  const image = {
    url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Venue.jpg",
    source: "https://commons.wikimedia.org/wiki/File:Venue.jpg",
    credit: "Author",
    rights: "open",
    checkedAt: "2026-10-09T00:00:00Z",
    license: "CC0",
  };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ image: null, retryable: true }))
    .mockResolvedValueOnce(Response.json({ image }));
  vi.stubGlobal("fetch", fetcher);
  expect(await findPlacePhoto(place)).toBeNull();
  expect(photoRetryDelay(place)).toBe(31000);
  const params = new URL(
    String(fetcher.mock.calls[0][0]),
    "https://example.com",
  ).searchParams;
  expect(params.get("commons")).toBe(place.commons);
  expect(params.get("osmImage")).toBe(place.osmImage);
  expect(JSON.parse(params.get("aliases")!)).toEqual(place.aliases);
  await vi.advanceTimersByTimeAsync(31000);
  expect(await findPlacePhoto(place)).toEqual(image);
  expect(photoRetryDelay(place)).toBeNull();
});

it("retries transient HTTP errors from the photo endpoint", async () => {
  vi.useFakeTimers();
  const place = { ...PLACES[0], id: "http-retry-test", image: undefined };
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response("temporarily unavailable", { status: 503 }),
      ),
  );
  expect(await findPlacePhoto(place)).toBeNull();
  expect(photoRetryDelay(place)).toBe(31000);
});
it("accepts a canonical Archive photo only with its matching exact-file source", async () => {
  const image = {
    url: "https://archive.org/download/venue-album/Folder/DSCN1.JPG",
    source: "https://archive.org/details/venue-album/Folder/DSCN1.JPG",
    credit: "Venue Photographer",
    rights: "open",
    checkedAt: "2026-10-09T00:00:00Z",
    license: "CC BY-SA 4.0",
    width: 4608,
    height: 3456,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ image })),
  );
  expect(
    await findPlacePhoto({
      ...PLACES[0],
      id: "archive-client-valid",
      image: undefined,
    }),
  ).toEqual(image);
  for (const [index, bad] of [
    {
      ...image,
      source: "https://archive.org/details/other-album/Folder/DSCN1.JPG",
    },
    {
      ...image,
      url: "https://archive.org.evil.test/download/venue-album/Folder/DSCN1.JPG",
    },
    { ...image, url: image.url + "?redirect=https://evil.test" },
  ].entries()) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ image: bad })),
    );
    expect(
      await findPlacePhoto({
        ...PLACES[0],
        id: `archive-client-invalid-${index}`,
        image: undefined,
      }),
    ).toBeNull();
  }
});

it("expires queued work from enqueue and never starts more than three network requests", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(() => new Promise<Response>(() => {}));
  vi.stubGlobal("fetch", fetcher);
  const promises = Array.from({ length: 12 }, (_, i) =>
    findPlacePhoto({ ...PLACES[0], id: `deadline-${i}`, image: undefined }),
  );
  expect(fetcher).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(4500);
  expect(await Promise.all(promises)).toEqual(Array(12).fill(null));
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("caches a definitive miss for a week", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => Response.json({ image: null }));
  vi.stubGlobal("fetch", fetcher);
  const place = { ...PLACES[0], id: "negative-week", image: undefined };
  await findPlacePhoto(place);
  await vi.advanceTimersByTimeAsync(86400000);
  await findPlacePhoto(place);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
