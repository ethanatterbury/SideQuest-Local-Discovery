import { expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createLocalSceneReviewer } from "../scripts/photo-vision/resolver.mjs";

const image = {
  url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Acorn_Park.jpg",
  source: "https://commons.wikimedia.org/wiki/File:Acorn_Park.jpg",
  credit: "Jane Photographer",
  license: "CC BY-SA 2.0",
  rights: "open" as const,
  strategy: "geograph-commons-source-id",
  checkedAt: "2026-10-29T00:00:00Z",
};
const bytes = Buffer.from(
  "ffd8ffe000104a46494600010100000100010000ffd9",
  "hex",
);
const scores = (venue = 0.9) => [
  { id: "venue-interior", score: 0.01 },
  { id: "venue-exterior", score: 0.01 },
  { id: "outdoor-place", score: venue },
  { id: "logo-illustration", score: 0.03 },
  { id: "portrait-event", score: 0.01 },
  { id: "product-food", score: 0.01 },
  { id: "ancillary-parking", score: 0.01 },
  { id: "construction", score: 0.01 },
  { id: "document", score: 0.01 },
];
const reviewer = (overrides = {}) =>
  createLocalSceneReviewer({
    download: async () => ({
      buffer: bytes,
      contentType: "image/jpeg",
      url: image.url,
    }),
    decodeImage: async () => ({ width: 800, height: 600 }),
    loadClassifier: async () => async () => scores(),
    ...overrides,
  });

it("records scene quality without inventing official-site identity or changing rights", async () => {
  const output = await reviewer()(image);
  expect(output).toMatchObject({
    accepted: true,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    width: 800,
    height: 600,
    localClip: { minScore: 0.8, minMargin: 0.5, bestVenueScore: 0.9 },
    diagnostics: { status: "accepted", modelStatus: "ready" },
  });
  expect(output).not.toHaveProperty("image");
  expect(output).not.toHaveProperty("preview");
  expect(image.rights).toBe("open");
});

it("checks licence, exact source family and strategy before loading a model", async () => {
  const loadClassifier = vi.fn(async () => async () => scores());
  for (const change of [
    { rights: "website-preview" },
    { license: "All rights reserved" },
    { strategy: "nearby-photo" },
    { url: "https://127.0.0.1/image.jpg" },
    { source: "https://geograph.org.uk/photo/123" },
  ]) {
    const result = await reviewer({ loadClassifier })({ ...image, ...change });
    expect(result.accepted).toBe(false);
    expect(result.diagnostics.status).toBe("ineligible");
  }
  expect(loadClassifier).not.toHaveBeenCalled();
});

it.each([
  {
    buffer: Buffer.from("<svg>logo</svg>"),
    contentType: "image/svg+xml",
    url: image.url,
  },
  { buffer: bytes, contentType: "image/png", url: image.url },
  {
    buffer: bytes,
    contentType: "image/jpeg",
    url: "https://elsewhere.co.uk/image.jpg",
  },
])("rejects unsafe or mismatched actual image bytes %j", async (downloaded) => {
  const classify = vi.fn(async () => scores());
  const output = await reviewer({
    download: async () => downloaded,
    loadClassifier: async () => classify,
  })(image);
  expect(output.accepted).toBe(false);
  expect(classify).not.toHaveBeenCalled();
});

it.each([
  { width: 239, height: 600 },
  { width: 8000, height: 6000 },
])("rejects unusable decoded dimensions %j", async (frame) => {
  const output = await reviewer({ decodeImage: async () => frame })(image);
  expect(output.accepted).toBe(false);
});

it("abstains on an uncertain scene and on incomplete model output", async () => {
  const uncertain = scores(0.6);
  uncertain[3].score = 0.33;
  const result = await reviewer({
    loadClassifier: async () => async () => uncertain,
  })(image);
  expect(result.diagnostics.status).toBe("rejected");
  expect(result.accepted).toBe(false);
  const malformed = await reviewer({
    loadClassifier: async () => async () => [],
  })(image);
  expect(malformed.diagnostics.status).toBe("unavailable");
  expect(malformed.accepted).toBe(false);
});

it("bounds stalled image downloads and supports an already cancelled batch", async () => {
  const result = await reviewer({ download: () => new Promise(() => {}) })(
    image,
    { timeoutMs: 10 },
  );
  expect(result.diagnostics.status).toBe("timeout");
  const controller = new AbortController();
  controller.abort();
  const loadClassifier = vi.fn();
  const cancelled = await reviewer({ loadClassifier })(image, {
    signal: controller.signal,
  });
  expect(cancelled.accepted).toBe(false);
  expect(cancelled.diagnostics.status).toBe("timeout");
  expect(loadClassifier).not.toHaveBeenCalled();
});
