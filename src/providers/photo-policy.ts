import type { Place } from "@/domain/models";
import { parseArchivePhotoUrl, safeArchivePhotoUrl } from "./archive-photo";
import { safeCommonsImageUrl } from "./commons-image-url";
import { rejectedPhotoSource } from "./rejected-photo-sources";

type Image = NonNullable<Place["image"]>;
export type PhotoPermission = {
  evidenceUrl: string;
  grantedAt: string;
  allowsRedistribution: true;
};
type Candidate = Image & { permission?: PhotoPermission };
export const LOCAL_PHOTO_REVIEW_MODEL = {
  id: "Xenova/clip-vit-base-patch32",
  revision: "d15189d7028b43f1d3e65039190477f6af591c2a",
  dtype: "q8",
  device: "cpu",
  library: "@huggingface/transformers",
  libraryVersion: "3.8.1",
} as const;
export const LOCAL_PHOTO_REVIEW_THRESHOLD = {
  minScore: 0.8,
  minMargin: 0.5,
} as const;
export const LOCAL_PHOTO_REVIEW_GROUPS: Record<string, "venue" | "reject"> = {
  "venue-interior": "venue",
  "venue-exterior": "venue",
  "outdoor-place": "venue",
  "logo-illustration": "reject",
  "portrait-event": "reject",
  "product-food": "reject",
  "ancillary-parking": "reject",
  construction: "reject",
  document: "reject",
};

/** Recompute the complete fixed prompt evidence; the method label grants nothing. */
function validLocalClipReview(preview: NonNullable<Image["preview"]>): boolean {
  const review = preview.review;
  const clip = review?.localClip;
  if (
    !review ||
    !/^[a-f0-9]{64}$/.test(review.sha256 ?? "") ||
    !clip ||
    !clip.model ||
    Object.entries(LOCAL_PHOTO_REVIEW_MODEL).some(
      ([key, value]) => clip.model[key as keyof typeof clip.model] !== value,
    ) ||
    clip.minScore !== LOCAL_PHOTO_REVIEW_THRESHOLD.minScore ||
    clip.minMargin !== LOCAL_PHOTO_REVIEW_THRESHOLD.minMargin ||
    !Array.isArray(clip.scores) ||
    clip.scores.length !== Object.keys(LOCAL_PHOTO_REVIEW_GROUPS).length ||
    clip.scores.some((score) => !score) ||
    new Set(clip.scores.map((score) => score.id)).size !== clip.scores.length ||
    clip.scores.some(
      (score) =>
        !score ||
        !Object.hasOwn(LOCAL_PHOTO_REVIEW_GROUPS, score.id) ||
        LOCAL_PHOTO_REVIEW_GROUPS[score.id] !== score.group ||
        !Number.isFinite(score.score) ||
        score.score < 0 ||
        score.score > 1,
    ) ||
    !preview.identityEvidence.includes(
      "venue name in page title, heading or business schema",
    ) ||
    !preview.identityEvidence.some(
      (value) =>
        value === "venue area in page metadata, path or business address" ||
        value === "venue address matched" ||
        value === "venue coordinates matched",
    )
  )
    return false;
  const venue = Math.max(
    ...clip.scores
      .filter((score) => score.group === "venue")
      .map((score) => score.score),
  );
  const reject = Math.max(
    ...clip.scores
      .filter((score) => score.group === "reject")
      .map((score) => score.score),
  );
  const margin = venue - reject;
  return (
    Math.abs(clip.scores.reduce((sum, score) => sum + score.score, 0) - 1) <
      1e-5 &&
    venue >= clip.minScore &&
    margin >= clip.minMargin &&
    Math.abs(clip.bestVenueScore - venue) < 1e-9 &&
    Math.abs(clip.bestRejectScore - reject) < 1e-9 &&
    Math.abs(clip.margin - margin) < 1e-9
  );
}
// Commons/archive keep their existing lookup budget; official discovery gets a larger route window.
export const PHOTO_DEADLINE_MS = 4500;
export const PHOTO_REQUEST_DEADLINE_MS = 6500;
export const PHOTO_NEGATIVE_TTL_MS = 7 * 86400000;
export const PHOTO_TRANSIENT_TTL_MS = 30000;

/** Attribution describes authorship. Only an explicit reuse license grants reuse. */
export function openPhotoLicense(license: string): boolean {
  return /^(?:CC(?:0| BY(?:-SA)?)(?: [0-9.]+)?|Public domain)$/i.test(
    license.trim(),
  );
}

/** Validate the separate externally hosted website-preview contract without granting reuse. */
function approvedWebsitePreview(
  image: Candidate,
  checkedAt?: string,
): Image | undefined {
  const preview = image.preview;
  const timestamp = image.checkedAt || checkedAt;
  if (
    image.strategy !== "official-website-preview" ||
    image.license !== "Website preview — rights reserved" ||
    !preview ||
    preview.pageUrl !== image.source ||
    preview.publisher !== image.credit ||
    !["open-graph", "twitter", "venue-image"].includes(preview.kind) ||
    !timestamp ||
    !Number.isFinite(Date.parse(timestamp))
  )
    return;
  const evidence = (values: unknown): boolean =>
    Array.isArray(values) &&
    values.length > 0 &&
    values.length <= 20 &&
    values.every(
      (value) =>
        typeof value === "string" && value.length > 0 && value.length <= 300,
    );
  if (!evidence(preview.identityEvidence) || !evidence(preview.subjectEvidence))
    return;
  if (
    preview.identityEvidence.includes("multi-branch operator") &&
    !preview.identityEvidence.includes("image attributed to the local branch")
  )
    return;
  const review = preview.review;
  const validReview =
    !!review &&
    [
      "visual-review",
      "image-analysis:web-image-search",
      "image-analysis:local-clip",
    ].includes(review.method) &&
    review.imageUrl === image.url &&
    typeof review.description === "string" &&
    review.description.trim().length >= 20 &&
    review.description.length <= 1000 &&
    Number.isFinite(Date.parse(review.checkedAt)) &&
    Date.parse(review.checkedAt) <= Date.now() + 300000 &&
    (!review.sha256 || /^[a-f0-9]{64}$/.test(review.sha256)) &&
    (review.method !== "image-analysis:local-clip" ||
      validLocalClipReview(preview));
  if (review && !validReview) return;
  if (
    preview.kind === "venue-image" &&
    !preview.subjectEvidence.some(
      (value) =>
        value === "physical venue scene in image metadata" ||
        value === "named outdoor attraction photograph" ||
        (validReview &&
          review?.method === "visual-review" &&
          value === "physical venue scene verified by visual review") ||
        (validReview &&
          review?.method === "image-analysis:web-image-search" &&
          value ===
            "physical venue scene described by external image analysis") ||
        (validReview &&
          review?.method === "image-analysis:local-clip" &&
          value === "physical venue scene classified by local model"),
    )
  )
    return;
  for (const value of [image.url, image.source]) {
    try {
      const url = new URL(value);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        !url.hostname.includes(".") ||
        /^[\d.]+$/.test(url.hostname) ||
        url.hostname.includes(":") ||
        /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(
          url.hostname,
        ) ||
        /(?:^|\.)(?:unsplash\.com|pexels\.com|pixabay\.com|shutterstock\.com|istockphoto\.com|gettyimages\.com|freepik\.com)$/.test(
          url.hostname,
        )
      )
        return;
    } catch {
      return;
    }
  }
  return { ...image, rights: "website-preview", checkedAt: timestamp };
}

/** Preserve prepared evidence; never upgrade a rights-reserved photo through attribution. */
export function approvedPhoto(
  image: Candidate | null | undefined,
  checkedAt?: string,
  allowPermissioned = false,
): Image | undefined {
  if (
    !image ||
    !image.credit?.trim() ||
    !image.source?.startsWith("https://") ||
    rejectedPhotoSource(image.source)
  )
    return;
  if (image.rights === "website-preview")
    return approvedWebsitePreview(image, checkedAt);
  const open = openPhotoLicense(image.license);
  try {
    const source = new URL(image.source);
    if (
      source.username ||
      source.password ||
      source.port ||
      source.protocol !== "https:"
    )
      return;
    if (open) {
      const commons =
        source.hostname === "commons.wikimedia.org" &&
        source.pathname.startsWith("/wiki/File:");
      const archive = safeArchivePhotoUrl(image.source, true);
      if (!commons && !archive) return;
      if (
        !image.url.startsWith("/images/") &&
        !/^\/venue-images\/[a-z0-9-]+-[a-f0-9]{12,16}\.webp$/.test(image.url)
      ) {
        const url = new URL(image.url);
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.port
        )
          return;
        if (commons && !safeCommonsImageUrl(image.url)) return;
        if (
          archive &&
          !(
            safeArchivePhotoUrl(image.url) &&
            parseArchivePhotoUrl(image.url)?.source === image.source
          )
        )
          return;
      }
    }
  } catch {
    return;
  }
  const permission = image.permission;
  if (
    !open &&
    !(
      allowPermissioned &&
      image.rights === "permissioned" &&
      permission?.allowsRedistribution === true &&
      /^https:\/\//.test(permission.evidenceUrl) &&
      Number.isFinite(Date.parse(permission.grantedAt))
    )
  )
    return;
  const timestamp = image.checkedAt || checkedAt;
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return;
  return {
    ...image,
    rights: open ? "open" : "permissioned",
    checkedAt: timestamp,
  };
}
