import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  await vi.runAllTimersAsync();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});
const base = { name: "Riverside Museum", lat: 55.865, lng: -4.306 };
const photo = () =>
  Response.json({
    query: {
      pages: [
        {
          title: "File:Riverside Museum.jpg",
          imageinfo: [
            {
              url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Riverside.jpg",
              descriptionurl:
                "https://commons.wikimedia.org/wiki/File:Riverside.jpg",
              width: 2000,
              height: 1200,
              mime: "image/jpeg",
              extmetadata: {
                Artist: { value: "Jane Doe" },
                LicenseShortName: { value: "CC BY-SA 4.0" },
              },
            },
          ],
        },
      ],
    },
  });
const flush = () => vi.advanceTimersByTimeAsync(0);

it("cancels a publisher race loser, closes its body and releases a photo slot immediately", async () => {
  const cancelledBody = vi.fn();
  let firstSignal: AbortSignal | undefined;
  const fetcher = vi.fn(async (url: URL, init?: RequestInit) => {
    if (url.searchParams.get("titles") === "File:next.jpg") return photo();
    if (url.searchParams.get("titles") === "File:first.jpg") {
      firstSignal = init?.signal ?? undefined;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("{"));
          },
          cancel: cancelledBody,
        }),
      );
    }
    return new Promise<Response>(() => {});
  });
  vi.stubGlobal("fetch", fetcher);
  const { lookupPlacePhoto } = await import("../src/providers/place-photo");
  const controller = new AbortController();
  let cancelled: unknown;
  const first = lookupPlacePhoto(
    { ...base, commons: "File:first.jpg" },
    { signal: controller.signal },
  ).then((result) => {
    cancelled = result;
    return result;
  });
  const held = ["second", "third"].map((id) =>
    lookupPlacePhoto({ ...base, commons: `File:${id}.jpg` }),
  );
  const next = lookupPlacePhoto({ ...base, commons: "File:next.jpg" });
  await flush();
  expect(fetcher).toHaveBeenCalledTimes(3);
  controller.abort();
  await flush();
  expect(cancelled).toMatchObject({
    image: null,
    source: "unavailable",
    retryable: true,
  });
  expect(firstSignal?.aborted).toBe(true);
  expect(cancelledBody).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(await next).toMatchObject({ image: { strategy: "osm-commons-file" } });
  await vi.runAllTimersAsync();
  await Promise.all([first, ...held]);
});

it("keeps a coalesced second consumer alive when the first consumer cancels", async () => {
  let release!: (response: Response) => void;
  let transportSignal: AbortSignal | undefined;
  const fetcher = vi.fn((_: unknown, init?: RequestInit) => {
    transportSignal = init?.signal ?? undefined;
    return new Promise<Response>((resolve) => {
      release = resolve;
    });
  });
  vi.stubGlobal("fetch", fetcher);
  const { lookupPlacePhoto } = await import("../src/providers/place-photo");
  const query = { ...base, commons: "File:shared.jpg" };
  const controller = new AbortController();
  let cancelled: unknown;
  const first = lookupPlacePhoto(query, { signal: controller.signal }).then(
    (result) => {
      cancelled = result;
      return result;
    },
  );
  const second = lookupPlacePhoto(query);
  await flush();
  controller.abort();
  await flush();
  expect(cancelled).toMatchObject({ image: null, retryable: true });
  expect(transportSignal?.aborted).toBe(false);
  release(photo());
  expect(await second).toMatchObject({
    image: { strategy: "osm-commons-file" },
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await first;
});

it("preserves a shared metadata request used by a different photo identity", async () => {
  let release!: (response: Response) => void;
  let transportSignal: AbortSignal | undefined;
  const fetcher = vi.fn((_: unknown, init?: RequestInit) => {
    transportSignal = init?.signal ?? undefined;
    return new Promise<Response>((resolve) => {
      release = resolve;
    });
  });
  vi.stubGlobal("fetch", fetcher);
  const { lookupPlacePhoto } = await import("../src/providers/place-photo");
  const controller = new AbortController();
  const first = lookupPlacePhoto(
    { ...base, id: "one", commons: "File:shared.jpg" },
    { signal: controller.signal },
  );
  const second = lookupPlacePhoto({
    ...base,
    id: "two",
    commons: "File:shared.jpg",
  });
  await flush();
  controller.abort();
  await flush();
  expect(transportSignal?.aborted).toBe(false);
  release(photo());
  expect(await second).toMatchObject({
    image: { strategy: "osm-commons-file" },
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await first).toMatchObject({ image: null, retryable: true });
});

it("removes an aborted queue waiter so another venue can join the bounded queue", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => {})),
  );
  const { lookupPlacePhoto } = await import("../src/providers/place-photo");
  const controllers = Array.from({ length: 12 }, () => new AbortController());
  const requests = controllers.map((controller, index) =>
    lookupPlacePhoto(
      { ...base, commons: `File:queued-${index}.jpg` },
      { signal: controller.signal },
    ),
  );
  await flush();
  controllers[3].abort();
  await flush();
  let replacement: unknown;
  const next = lookupPlacePhoto(
    { ...base, commons: "File:replacement.jpg" },
    { debug: true },
  ).then((result) => {
    replacement = result;
    return result;
  });
  await flush();
  expect(replacement).toBeUndefined();
  controllers.forEach((controller) => controller.abort());
  await flush();
  await vi.runAllTimersAsync();
  expect((await next).diagnostics?.rejected).not.toHaveProperty(
    "concurrency-limit",
  );
  await Promise.all(requests);
});

it("does not poison caches or continue source attempts after the final consumer cancels", async () => {
  let firstSignal: AbortSignal | undefined;
  const fetcher = vi.fn((_: unknown, init?: RequestInit) => {
    if (fetcher.mock.calls.length === 1) {
      firstSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    }
    return Promise.resolve(photo());
  });
  vi.stubGlobal("fetch", fetcher);
  const { lookupPlacePhoto } = await import("../src/providers/place-photo");
  const controller = new AbortController();
  const query = { ...base, commons: "File:retry.jpg", wikidata: "Q123" };
  const first = lookupPlacePhoto(query, { signal: controller.signal });
  await flush();
  controller.abort();
  await flush();
  expect(firstSignal?.aborted).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await lookupPlacePhoto(query)).toMatchObject({
    source: "live",
    image: { strategy: "osm-commons-file" },
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(await first).toMatchObject({ image: null, retryable: true });
});

it("handles cancellation triggered synchronously while a metadata transport starts", async () => {
  const controller = new AbortController();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      controller.abort();
      return Promise.reject(new Error("transport aborted"));
    }),
  );
  const { lookupPlacePhoto } = await import("../src/providers/place-photo");
  expect(
    await lookupPlacePhoto(
      { ...base, commons: "File:sync-abort.jpg" },
      {
        signal: controller.signal,
      },
    ),
  ).toMatchObject({ image: null, source: "unavailable", retryable: true });
  await flush();
});
