import { expect, it, vi } from "vitest";
import { withLocalPhotoReview } from "../scripts/lib/offline-photo-preview.mjs";
import { createLocalPhotoReviewer } from "../scripts/photo-vision/resolver.mjs";
import { LOCAL_PHOTO_REVIEW_GROUPS } from "../src/providers/photo-policy";

const query = { name: "A play place", lat: 51, lng: -1 };
const unresolved = {
  image: null,
  retryable: false,
  result: { reviewCandidates: [{ url: "https://play.co.uk/interior.jpg" }] },
};

it("composes real image review with batch refresh options", async () => {
  const url = "https://play.co.uk/interior.jpg";
  const source = "https://play.co.uk/";
  const evidence = [
    "venue name in page title, heading or business schema",
    "venue area in page metadata, path or business address",
  ];
  const official = {
    image: null,
    retryable: false,
    result: {
      pageUrl: source,
      identity: {
        matchedName: true,
        matchedArea: true,
        branchSpecific: true,
        multiBranch: false,
        evidence,
      },
      reviewCandidates: [
        {
          url,
          source,
          kind: "body",
          identityEvidence: evidence,
          subjectEvidence: [],
          photoScore: 20,
          reason: "unconfirmed-photo-subject",
        },
      ],
    },
  };
  const classify = vi.fn(async () =>
    Object.entries(LOCAL_PHOTO_REVIEW_GROUPS).map(([id, group]) => ({
      id,
      group,
      score:
        id === "venue-interior"
          ? 0.9
          : id === "logo-illustration"
            ? 0.03
            : 0.01,
    })),
  );
  const review = createLocalPhotoReviewer({
    loadClassifier: async () => classify,
    download: async () => ({
      buffer: Buffer.from(
        "ffd8ffe000104a46494600010100000100010000ffd9",
        "hex",
      ),
      contentType: "image/jpeg",
      url,
    }),
    decodeImage: async () => ({ width: 800, height: 600 }),
  });
  const output = await withLocalPhotoReview(async () => official, review)(
    query,
    { timeoutMs: 12000, refresh: false },
  );
  expect(
    output.result.vision,
    JSON.stringify(output.result.vision),
  ).toMatchObject({ status: "accepted" });
  expect(output.image?.preview?.review?.method).toBe(
    "image-analysis:local-clip",
  );
  expect(classify).toHaveBeenCalledOnce();
});

it("only reviews vetted candidates during explicit maintenance and retains the remaining deadline", async () => {
  let time = 100;
  const resolve = vi.fn(async () => {
    time += 300;
    return unresolved;
  });
  const image = { url: "https://play.co.uk/interior.jpg" };
  const review = vi.fn(async () => ({
    image,
    diagnostics: { status: "accepted" },
  }));
  const result = await withLocalPhotoReview(
    resolve,
    review,
    () => time,
  )(query, { timeoutMs: 1200 });
  expect(resolve).toHaveBeenCalledWith(query, {
    timeoutMs: 1200,
    collectReviewCandidates: true,
  });
  expect(review).toHaveBeenCalledWith(query, unresolved.result, {
    timeoutMs: 900,
    maxCandidates: 2,
  });
  expect(result.image).toBe(image);
  expect(result.retryable).toBe(false);
});

it("leaves approved metadata photos and pages without eligible candidates alone", async () => {
  const review = vi.fn();
  const image = { url: "https://play.co.uk/interior.jpg" };
  const prepared = { ...unresolved, image };
  expect(await withLocalPhotoReview(async () => prepared, review)(query)).toBe(
    prepared,
  );
  const absent = { ...unresolved, result: { reviewCandidates: [] } };
  expect(await withLocalPhotoReview(async () => absent, review)(query)).toBe(
    absent,
  );
  expect(review).not.toHaveBeenCalled();
});

it("keeps model infrastructure failures retryable rather than recording a missing photo", async () => {
  const review = vi.fn(async () => {
    throw new Error("model unavailable");
  });
  const result = await withLocalPhotoReview(
    async () => unresolved,
    review,
  )(query);
  expect(result.image).toBeNull();
  expect(result.retryable).toBe(true);
  expect(result.result.vision.status).toBe("unavailable");
});

it("does not start image downloads after the website exhausted the maintenance deadline", async () => {
  let time = 0;
  const review = vi.fn();
  const result = await withLocalPhotoReview(
    async () => {
      time = 1200;
      return unresolved;
    },
    review,
    () => time,
  )(query, { timeoutMs: 1200 });
  expect(result.retryable).toBe(true);
  expect(result.result.vision.status).toBe("timeout");
  expect(review).not.toHaveBeenCalled();
});
