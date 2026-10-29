import { expect, it } from "vitest";
import { approvedPhoto } from "../src/providers/photo-policy";
import type { LocalClipPhotoEvidence } from "../src/domain/models";

const checkedAt = "2026-10-29T00:00:00Z";
const image = () => ({
  url: "https://acornplay.co.uk/media/1729.jpg",
  source: "https://acornplay.co.uk/fleet/",
  credit: "Acorn Play",
  license: "Website preview — rights reserved",
  rights: "website-preview" as const,
  strategy: "official-website-preview",
  checkedAt,
  preview: {
    kind: "venue-image" as const,
    pageUrl: "https://acornplay.co.uk/fleet/",
    publisher: "Acorn Play",
    identityEvidence: [
      "venue name in page title, heading or business schema",
      "venue area in page metadata, path or business address",
    ],
    subjectEvidence: ["physical venue scene classified by local model"],
    review: {
      method: "image-analysis:local-clip" as const,
      imageUrl: "https://acornplay.co.uk/media/1729.jpg",
      checkedAt,
      description:
        "Offline model classification of the image; generic venue scene score, not venue identity verification.",
      sha256: "a".repeat(64),
      localClip: {
        model: {
          id: "Xenova/clip-vit-base-patch32",
          revision: "d15189d7028b43f1d3e65039190477f6af591c2a",
          dtype: "q8",
          device: "cpu",
          library: "@huggingface/transformers",
          libraryVersion: "3.8.1",
        },
        minScore: 0.8,
        minMargin: 0.5,
        bestVenueScore: 0.9,
        bestRejectScore: 0.03,
        margin: 0.87,
        scores: [
          { id: "venue-interior", group: "venue", score: 0.9 },
          { id: "venue-exterior", group: "venue", score: 0.01 },
          { id: "outdoor-place", group: "venue", score: 0.01 },
          { id: "logo-illustration", group: "reject", score: 0.03 },
          { id: "portrait-event", group: "reject", score: 0.01 },
          { id: "product-food", group: "reject", score: 0.01 },
          { id: "ancillary-parking", group: "reject", score: 0.01 },
          { id: "construction", group: "reject", score: 0.01 },
          { id: "document", group: "reject", score: 0.01 },
        ] satisfies LocalClipPhotoEvidence["scores"],
      },
    },
  },
});

it("accepts complete conservative local model evidence without granting redistribution", () => {
  expect(approvedPhoto(image())?.rights).toBe("website-preview");
});

it("accepts exact coordinate location evidence while still requiring official name proof", () => {
  const candidate = image();
  candidate.preview.identityEvidence = [
    "venue name in page title, heading or business schema",
    "venue coordinates matched",
  ];
  expect(approvedPhoto(candidate)?.rights).toBe("website-preview");
  candidate.preview.identityEvidence = ["venue coordinates matched"];
  expect(approvedPhoto(candidate)).toBeUndefined();
  candidate.preview.identityEvidence = [
    "venue name in page title, heading or business schema",
    "coordinates nearby",
  ];
  expect(approvedPhoto(candidate)).toBeUndefined();
});

it("never treats the local method name or subject marker alone as approval", () => {
  const candidate = image();
  Reflect.deleteProperty(candidate.preview.review, "localClip");
  expect(approvedPhoto(candidate)).toBeUndefined();
});

it("requires exact URL, original byte hash, pinned model and independently recomputable scores", () => {
  const invalid = [
    (x: ReturnType<typeof image>) => {
      x.preview.review.imageUrl += "?different";
    },
    (x: ReturnType<typeof image>) => {
      x.preview.review.sha256 = "";
    },
    (x: ReturnType<typeof image>) => {
      x.preview.review.localClip.model.revision = "main";
    },
    (x: ReturnType<typeof image>) => {
      x.preview.review.localClip.model.dtype = "fp32";
    },
    (x: ReturnType<typeof image>) => {
      x.preview.review.localClip.minScore = 0.5;
    },
    (x: ReturnType<typeof image>) => {
      x.preview.review.localClip.minMargin = 0.1;
    },
    (x: ReturnType<typeof image>) => {
      x.preview.review.localClip.bestVenueScore = 0.99;
    },
    (x: ReturnType<typeof image>) => {
      x.preview.review.localClip.scores[0].score = 0.601;
    },
    (x: ReturnType<typeof image>) => {
      x.preview.review.localClip.scores[3].score = 0.8;
    },
    (x: ReturnType<typeof image>) => {
      x.preview.review.localClip.scores[1].score = 0.02;
    },
    (x: ReturnType<typeof image>) => {
      x.preview.review.localClip.scores.pop();
    },
    (x: ReturnType<typeof image>) => {
      Reflect.set(x.preview.review.localClip.scores, "0", null);
    },
    (x: ReturnType<typeof image>) => {
      x.preview.review.localClip.scores[3].group = "venue";
    },
    (x: ReturnType<typeof image>) => {
      x.preview.identityEvidence = [
        "venue name in page title, heading or business schema",
      ];
    },
  ];
  for (const corrupt of invalid) {
    const candidate = image();
    corrupt(candidate);
    expect(approvedPhoto(candidate)).toBeUndefined();
  }
});
