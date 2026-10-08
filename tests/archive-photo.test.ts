import { afterEach, expect, it, vi } from "vitest";
import {
  archiveJpegDimensions,
  parseArchivePhotoUrl,
  resolveArchivePhoto,
  safeArchivePhotoUrl,
} from "../src/providers/archive-photo";

const details =
  "https://archive.org/details/example-album/Some%20Folder/DSCN7562.JPG";
const download =
  "https://archive.org/download/example-album/Some%20Folder/DSCN7562.JPG";
const mirror =
  "https://dn721902.ca.archive.org/0/items/example-album/Some%20Folder/DSCN7562.JPG";
const metadata = {
  metadata: {
    identifier: "example-album",
    mediatype: "image",
    creator: "Paul Williams",
    licenseurl: "https://creativecommons.org/licenses/by-sa/4.0/",
  },
  files: [
    {
      name: "Some Folder/DSCN7562.JPG",
      source: "original",
      format: "JPEG",
      size: "4244863",
      rotation: "0",
    },
  ],
};
// SOF0: 4608 × 3456, followed by start-of-scan.
const jpeg = new Uint8Array([
  0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 13, 128, 18, 0, 3, 1, 0x11, 0, 2, 0x11, 0,
  3, 0x11, 0, 0xff, 0xda,
]);
function image(bytes = jpeg): Response {
  return new Response(bytes, {
    status: 206,
    headers: {
      "content-type": "image/jpeg",
      "content-range": `bytes 0-${bytes.length - 1}/4244863`,
    },
  });
}
function transport(data: unknown = metadata, response: () => Response = image) {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(data))
    .mockImplementation(async () => response());
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("parses explicit JPEG bindings and only emits canonical restricted image/source URLs", () => {
  expect(parseArchivePhotoUrl(details)).toMatchObject({
    identifier: "example-album",
    file: "Some Folder/DSCN7562.JPG",
    download,
    source: details,
  });
  expect(safeArchivePhotoUrl(download)).toBe(true);
  expect(safeArchivePhotoUrl(details, true)).toBe(true);
  expect(safeArchivePhotoUrl(details)).toBe(false);
  expect(safeArchivePhotoUrl(download, true)).toBe(false);
});
it("rejects SSRF, credentials, queries, encoded traversal, encoded separators and non-photo album paths before networking", async () => {
  const fetcher = vi.fn<typeof fetch>();
  for (const value of [
    "http://archive.org/download/a/b.jpg",
    "https://archive.org.evil.test/download/a/b.jpg",
    "https://user:pass@archive.org/download/a/b.jpg",
    "https://archive.org:443/download/a/b.jpg",
    "https://archive.org/download/a/b.jpg?q=1",
    "https://archive.org/download/a/b.jpg#fragment",
    "https://archive.org/download/a/../b.jpg",
    "https://archive.org/download/a/%2e%2e/b.jpg",
    "https://archive.org/download/a/%252e%252e/b.jpg",
    "https://archive.org/download/a/folder%2fb.jpg",
    "https://archive.org/download/a/folder%5cb.jpg",
    "https://archive.org/download/a/%00b.jpg",
    "https://archive.org/details/a",
    "https://archive.org/download/a/b.svg",
    mirror,
  ]) {
    expect(parseArchivePhotoUrl(value)).toBeNull();
    expect((await resolveArchivePhoto(value, { fetch: fetcher })).reason).toBe(
      "invalid-archive-url",
    );
  }
  expect(fetcher).not.toHaveBeenCalled();
});
it("accepts generic camera filenames from exact OSM bindings with verified inventory and reusable attribution", async () => {
  const fetcher = transport();
  const result = await resolveArchivePhoto(details, { fetch: fetcher });
  expect(result.image).toMatchObject({
    url: download,
    source: details,
    width: 4608,
    height: 3456,
    credit: "Paul Williams",
    license: "CC BY-SA 4.0",
    strategy: "osm-archive",
  });
  expect(result.requestCount).toBe(2);
  expect(fetcher.mock.calls[0][0]).toBe(
    "https://archive.org/metadata/example-album",
  );
  expect(fetcher.mock.calls[1][1]).toMatchObject({
    redirect: "manual",
    headers: { Range: "bytes=0-131071" },
  });
});
it("rejects missing exact inventory files, unlicensed albums, mismatched identifiers, and missing creator", async () => {
  const cases = [
    { data: { ...metadata, files: [] }, reason: "missing-exact-file" },
    {
      data: {
        ...metadata,
        metadata: {
          ...metadata.metadata,
          licenseurl: "https://creativecommons.org/licenses/by-nc/4.0/",
        },
      },
      reason: "unlicensed",
    },
    {
      data: { ...metadata, metadata: { ...metadata.metadata, creator: "" } },
      reason: "missing-creator",
    },
    {
      data: {
        ...metadata,
        metadata: { ...metadata.metadata, identifier: "other" },
      },
      reason: "invalid-item-metadata",
    },
    {
      data: {
        ...metadata,
        files: [{ ...metadata.files[0], licenseurl: "All rights reserved" }],
      },
      reason: "file-license-conflict",
    },
  ];
  for (const { data, reason } of cases) {
    const fetcher = transport(data);
    expect(
      await resolveArchivePhoto(details, { fetch: fetcher }),
    ).toMatchObject({ image: null, reason, retryable: false, requestCount: 1 });
  }
});
it.each([
  ["https://creativecommons.org/licenses/by/3.0/", "CC BY 3.0"],
  ["https://creativecommons.org/publicdomain/zero/1.0/", "CC0 1.0"],
  ["https://creativecommons.org/publicdomain/mark/1.0/", "Public domain"],
])(
  "recognizes the explicit reusable licence %s",
  async (licenseurl, expected) => {
    const data = {
      ...metadata,
      metadata: { ...metadata.metadata, licenseurl },
    };
    expect(
      (await resolveArchivePhoto(details, { fetch: transport(data) })).image
        ?.license,
    ).toBe(expected);
  },
);
it("checks exact archive mirror hostname and exact original file on each manual redirect", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(metadata))
    .mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: mirror } }),
    )
    .mockResolvedValueOnce(image());
  expect(
    (await resolveArchivePhoto(details, { fetch: fetcher })).image?.url,
  ).toBe(download);
  expect(fetcher.mock.calls[2][0]).toBe(mirror);
  for (const location of [
    "https://127.0.0.1/a.jpg",
    "https://dn721902.ca.archive.org.evil.test/0/items/example-album/Some%20Folder/DSCN7562.JPG",
    mirror.replace("DSCN7562", "DSCN9999"),
    mirror.replace("/Some%20Folder/", "/%2e%2e/Some%20Folder/"),
    `${mirror}?tracking=1`,
  ]) {
    const badFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(metadata))
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location } }),
      );
    expect(
      await resolveArchivePhoto(details, { fetch: badFetch }),
    ).toMatchObject({ reason: "unsafe-redirect", requestCount: 2 });
  }
});
it("limits redirect loops and reports upstream throttling as retryable", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(metadata))
    .mockImplementation(
      async () =>
        new Response(null, { status: 302, headers: { location: mirror } }),
    );
  expect(await resolveArchivePhoto(details, { fetch: fetcher })).toMatchObject({
    reason: "unsafe-redirect",
    requestCount: 5,
  });
  expect(
    await resolveArchivePhoto(details, {
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 429 })),
    }),
  ).toMatchObject({ reason: "metadata-http", retryable: true });
});
it("bounds metadata bytes and cancels the response", async () => {
  const cancelled = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024 + 1));
    },
    cancel: cancelled,
  });
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(body, { headers: { "content-type": "application/json" } }),
    );
  expect(await resolveArchivePhoto(details, { fetch: fetcher })).toMatchObject({
    reason: "metadata-too-large",
    retryable: false,
  });
  expect(cancelled).toHaveBeenCalled();
});
it("reads at most a 128KiB JPEG prefix even when the server ignores Range", async () => {
  const cancelled = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const bytes = new Uint8Array(512 * 1024);
      bytes.set(jpeg);
      controller.enqueue(bytes);
    },
    cancel: cancelled,
  });
  const fetcher = transport(
    metadata,
    () =>
      new Response(body, {
        headers: { "content-type": "image/jpeg", "content-length": "4244863" },
      }),
  );
  expect(
    (await resolveArchivePhoto(details, { fetch: fetcher })).image?.width,
  ).toBe(4608);
  expect(cancelled).toHaveBeenCalled();
});
it("finishes within the deadline when fetch ignores its AbortSignal", async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(() => new Promise(() => {}));
  const pending = resolveArchivePhoto(details, {
    fetch: fetcher,
    timeoutMs: 25,
  });
  await vi.advanceTimersByTimeAsync(25);
  expect(await pending).toMatchObject({
    image: null,
    reason: "timeout-or-abort",
    retryable: true,
  });
});
it("finishes and cancels a stuck body even when the reader ignores abort", async () => {
  vi.useFakeTimers();
  const cancelled = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    pull: () => new Promise(() => {}),
    cancel: cancelled,
  });
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(body, { headers: { "content-type": "application/json" } }),
    );
  const pending = resolveArchivePhoto(details, {
    fetch: fetcher,
    timeoutMs: 25,
  });
  await vi.advanceTimersByTimeAsync(25);
  expect(await pending).toMatchObject({
    reason: "timeout-or-abort",
    retryable: true,
  });
  expect(cancelled).toHaveBeenCalled();
});
it("does not perform network requests for an already aborted caller", async () => {
  const controller = new AbortController();
  controller.abort();
  const fetcher = vi.fn<typeof fetch>();
  expect(
    await resolveArchivePhoto(details, {
      fetch: fetcher,
      signal: controller.signal,
    }),
  ).toMatchObject({ reason: "timeout-or-abort", requestCount: 0 });
});
it("reads EXIF rotation and exposes the displayed portrait dimensions", async () => {
  const exif = new Uint8Array([
    0xff, 0xe1, 0, 34, 69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0, 1, 0,
    0x12, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
  ]);
  const rotated = new Uint8Array(jpeg.length + exif.length);
  rotated.set(jpeg.subarray(0, 2));
  rotated.set(exif, 2);
  rotated.set(jpeg.subarray(2), 2 + exif.length);
  expect(archiveJpegDimensions(rotated)).toEqual({
    width: 4608,
    height: 3456,
    orientation: 6,
  });
  const data = {
    ...metadata,
    files: [{ ...metadata.files[0], rotation: "90" }],
  };
  expect(
    (
      await resolveArchivePhoto(details, {
        fetch: transport(data, () => image(rotated)),
      })
    ).image,
  ).toMatchObject({ width: 3456, height: 4608 });
  expect(
    archiveJpegDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 255])),
  ).toBeNull();
});
it("rejects non-JPEG transport, misleading ranges, invalid JPEG bytes and tiny pictures", async () => {
  for (const response of [
    () => new Response(jpeg, { headers: { "content-type": "text/html" } }),
    () =>
      new Response(jpeg, {
        status: 206,
        headers: {
          "content-type": "image/jpeg",
          "content-range": "bytes 200-300/4244863",
        },
      }),
    () => image(new Uint8Array([1, 2, 3])),
    () => {
      const bytes = jpeg.slice();
      bytes[7] = 0;
      bytes[8] = 20;
      return image(bytes);
    },
  ])
    expect(
      (
        await resolveArchivePhoto(details, {
          fetch: transport(metadata, response),
        })
      ).image,
    ).toBeNull();
});
