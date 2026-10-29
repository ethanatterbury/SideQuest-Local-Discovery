import { expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createLocalPhotoReviewer } from "../scripts/photo-vision/resolver.mjs";
import { approvedPhoto } from "../src/providers/photo-policy";
import sharp from "sharp";

const imageUrl = "https://acornplay.co.uk/media/1729.jpg";
const source = "https://acornplay.co.uk/fleet/";
const query = {
  name: "Acorn Play",
  area: "Fleet",
  lat: 51.3,
  lng: -0.8,
  website: source,
};
const identityEvidence = [
  "venue name in page title, heading or business schema",
  "venue area in page metadata, path or business address",
];
const candidate = {
  url: imageUrl,
  source,
  kind: "body",
  identityEvidence,
  photoScore: 20,
  subjectEvidence: [],
  reason: "unconfirmed-venue-scene",
};
const result = () => ({
  pageUrl: source,
  identity: {
    matchedName: true,
    matchedArea: true,
    matchedAddress: false,
    branchSpecific: true,
    multiBranch: false,
    evidence: identityEvidence,
  },
  candidates: [],
  reviewCandidates: [{ ...candidate }],
});
// Network and the 154 MB model are external boundaries. Decoding/inference doubles
// keep all input validation, policy approval, byte hashes and deadline logic real.
const bytes = Buffer.from(
  "ffd8ffe000104a46494600010100000100010000ffd9",
  "hex",
);
const download = async () => ({
  buffer: bytes,
  contentType: "image/jpeg",
  url: imageUrl,
});
const decodeImage = async () => ({ width: 800, height: 600 });
const scores = (venue = 0.9, reject = 0.03) => [
  { id: "venue-interior", group: "venue", score: venue },
  { id: "venue-exterior", group: "venue", score: 0.01 },
  { id: "outdoor-place", group: "venue", score: 0.01 },
  { id: "logo-illustration", group: "reject", score: reject },
  { id: "portrait-event", group: "reject", score: 0.01 },
  { id: "product-food", group: "reject", score: 0.01 },
  { id: "ancillary-parking", group: "reject", score: 0.01 },
  { id: "construction", group: "reject", score: 0.01 },
  { id: "document", group: "reject", score: 0.01 },
];
const reviewer = (classify = async () => scores(), overrides = {}) =>
  createLocalPhotoReviewer({
    download,
    decodeImage,
    loadClassifier: async () => classify,
    ...overrides,
  });

it("records an honest model decision tied to the original external image bytes and page", async () => {
  const review = reviewer();
  const output = await review(query, result());
  expect(output.diagnostics.status).toBe("accepted");
  expect(approvedPhoto(output.image)?.url).toBe(imageUrl);
  expect(output.image).toMatchObject({
    source,
    rights: "website-preview",
    license: "Website preview — rights reserved",
    preview: {
      pageUrl: source,
      identityEvidence,
      subjectEvidence: ["physical venue scene classified by local model"],
      review: {
        method: "image-analysis:local-clip",
        imageUrl,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        localClip: {
          model: {
            id: "Xenova/clip-vit-base-patch32",
            revision: "d15189d7028b43f1d3e65039190477f6af591c2a",
            dtype: "q8",
            device: "cpu",
          },
          minScore: 0.8,
          minMargin: 0.5,
          bestVenueScore: 0.9,
          bestRejectScore: 0.03,
        },
      },
    },
  });
  expect(output.image?.preview?.review?.description).toContain(
    "model classification",
  );
  expect(output.image?.confidence).toBeLessThanOrEqual(0.8);
});

it("abstains on the known construction false-positive range and rejects logos", async () => {
  for (const [venue, reject] of [
    [0.601, 0.329],
    [0.79, 0.14],
    [0.02, 0.91],
  ]) {
    const output = await reviewer(async () => scores(venue, reject))(
      query,
      result(),
    );
    expect(output.image).toBeNull();
    expect(output.diagnostics.status).toBe("rejected");
  }
});

it("requires official venue, location, branch and exact source evidence before loading the model", async () => {
  for (const change of [
    { identity: { ...result().identity, matchedName: false } },
    {
      identity: {
        ...result().identity,
        matchedArea: false,
        matchedAddress: false,
      },
    },
    { identity: { ...result().identity, branchSpecific: false } },
    {
      reviewCandidates: [
        { ...candidate, source: "https://acornplay.co.uk/another-branch/" },
      ],
    },
    { reviewCandidates: [{ ...candidate, identityEvidence: [] }] },
    {
      reviewCandidates: [
        { ...candidate, url: "https://127.0.0.1/private.jpg" },
      ],
    },
  ]) {
    const loadClassifier = vi.fn(async () => {
      throw new Error("must not load");
    });
    const output = await reviewer(undefined, { loadClassifier })(query, {
      ...result(),
      ...change,
    });
    expect(output.image).toBeNull();
    expect(output.diagnostics.status).toBe("ineligible");
    expect(loadClassifier).not.toHaveBeenCalled();
  }
});

it("preserves verified branch image evidence for chain venues and refuses missing branch attribution", async () => {
  const input = result();
  input.identity.multiBranch = true;
  input.identity.evidence = [...identityEvidence, "multi-branch operator"];
  input.reviewCandidates[0].identityEvidence = [
    ...input.identity.evidence,
    "image attributed to the local branch",
  ];
  const output = await reviewer()(query, input);
  expect(output.diagnostics.status).toBe("accepted");
  expect(output.image?.preview?.identityEvidence).toEqual(
    input.reviewCandidates[0].identityEvidence,
  );
  input.reviewCandidates[0].identityEvidence = [...input.identity.evidence];
  expect((await reviewer()(query, input)).diagnostics.status).toBe(
    "ineligible",
  );
});

it("rejects unsupported overrides, corrupt frames and mismatched content types", async () => {
  expect(
    (await reviewer()(query, result(), { minScore: 0.1 })).diagnostics.status,
  ).toBe("ineligible");
  for (const overrides of [
    {
      download: async () => ({
        buffer: Buffer.from("<html>not a photo</html>"),
        contentType: "image/jpeg",
        url: imageUrl,
      }),
    },
    {
      download: async () => ({
        buffer: bytes,
        contentType: "image/png",
        url: imageUrl,
      }),
    },
    {
      decodeImage: async () => {
        throw new Error("corrupt frame");
      },
    },
    { decodeImage: async () => ({ width: 40, height: 40 }) },
  ]) {
    const output = await reviewer(undefined, overrides)(query, result());
    expect(output.image).toBeNull();
    expect(output.diagnostics.status).toBe("rejected");
  }
});

it("bounds attempts at two unique candidates and loads one reusable model", async () => {
  const loadClassifier = vi.fn(async () => async () => scores(0.1, 0.83));
  const review = reviewer(undefined, { loadClassifier });
  const input = {
    ...result(),
    reviewCandidates: [
      candidate,
      candidate,
      { ...candidate, url: "https://acornplay.co.uk/2.jpg" },
      { ...candidate, url: "https://acornplay.co.uk/3.jpg" },
    ],
  };
  expect((await review(query, input)).diagnostics.attempted).toBe(2);
  expect((await review(query, result())).diagnostics.attempted).toBe(1);
  expect(loadClassifier).toHaveBeenCalledTimes(1);
});

it("reports infrastructure and deadline failures as retryable diagnostic states", async () => {
  const failed = await reviewer(undefined, {
    loadClassifier: async () => {
      throw new Error("model unavailable");
    },
  })(query, result());
  expect(failed).toMatchObject({
    image: null,
    diagnostics: { status: "unavailable", modelStatus: "unavailable" },
  });
  const timed = await reviewer(undefined, {
    download: () => new Promise(() => {}),
  })(query, result(), { timeoutMs: 15 });
  expect(timed).toMatchObject({
    image: null,
    diagnostics: { status: "timeout" },
  });
});

it("allows a model load to recover after a transient initialization failure", async () => {
  let attempts = 0;
  const review = reviewer(undefined, {
    loadClassifier: async () => {
      if (++attempts === 1) throw new Error("transient model failure");
      return async () => scores();
    },
  });
  expect((await review(query, result())).diagnostics.status).toBe(
    "unavailable",
  );
  expect((await review(query, result())).diagnostics.status).toBe("accepted");
});

it("tries the second candidate after a publisher image download fails", async () => {
  const second = "https://acornplay.co.uk/second.jpg";
  const review = reviewer(undefined, {
    download: async (url: string) =>
      url === imageUrl
        ? null
        : { buffer: bytes, contentType: "image/jpeg", url },
  });
  const input = {
    ...result(),
    reviewCandidates: [candidate, { ...candidate, url: second }],
  };
  const output = await review(query, input);
  expect(output.diagnostics.status).toBe("accepted");
  expect(output.diagnostics.attempted).toBe(2);
  expect(output.image?.url).toBe(second);
});

it("refuses missing, duplicate, nonfinite or wrongly grouped model scores", async () => {
  for (const output of [
    scores().slice(0, 8),
    [...scores(), scores()[0]],
    scores().map((s) => ({ ...s, score: Number.NaN })),
    scores().map((s) => ({ ...s, group: "venue" })),
    scores().map((s) => ({ ...s, score: 0.9 })),
  ]) {
    const reviewed = await reviewer(async () => output)(query, result());
    expect(reviewed.image).toBeNull();
    expect(reviewed.diagnostics.status).toBe("unavailable");
  }
});

it("decodes a real JPEG in memory while refusing corrupted JPEG bytes", async () => {
  const buffer = await sharp({
    create: { width: 640, height: 480, channels: 3, background: "#349060" },
  })
    .jpeg()
    .toBuffer();
  const loadClassifier =
    async () =>
    async (frame: { width: number; height: number; data: Uint8Array }) => {
      expect(frame.width).toBe(640);
      expect(frame.height).toBe(480);
      expect(frame.data.length).toBeGreaterThan(600_000);
      return scores();
    };
  const review = createLocalPhotoReviewer({
    loadClassifier,
    download: async () => ({
      buffer,
      contentType: "image/jpeg",
      url: imageUrl,
    }),
  });
  expect((await review(query, result())).diagnostics.status).toBe("accepted");
  const corrupt = createLocalPhotoReviewer({ loadClassifier, download });
  expect((await corrupt(query, result())).diagnostics.status).toBe("rejected");
});
