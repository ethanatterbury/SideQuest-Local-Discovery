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
