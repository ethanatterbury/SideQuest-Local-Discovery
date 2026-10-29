import { createHash } from "node:crypto";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProvider } from "../lib/provider-loader.mjs";

const { downloadOfficialPhoto, safeOfficialPhotoUrl } = loadProvider(
  "src/providers/official-photo.ts",
);
const {
  approvedPhoto,
  LOCAL_PHOTO_REVIEW_MODEL: model,
  LOCAL_PHOTO_REVIEW_THRESHOLD: threshold,
  LOCAL_PHOTO_REVIEW_GROUPS: groups,
} = loadProvider("src/providers/photo-policy.ts");
const root = fileURLToPath(new URL("../../", import.meta.url));
const prompts = [
  {
    id: "venue-interior",
    text: "a photograph of a leisure venue interior, showing rooms, gym equipment, play structures or restaurant tables",
  },
  {
    id: "venue-exterior",
    text: "a photograph of a venue building exterior or its main visitor entrance",
  },
  {
    id: "outdoor-place",
    text: "a photograph of a public park, woodland, lake, nature reserve, sports field or playground",
  },
  {
    id: "logo-illustration",
    text: "a logo, cartoon, illustration or branded graphic banner",
  },
  {
    id: "portrait-event",
    text: "a close-up portrait, posed person, staff team or award presentation photograph",
  },
  { id: "product-food", text: "a close-up product, food or drink photograph" },
  {
    id: "ancillary-parking",
    text: "a photograph of a car park, parked cars, building service area or loading yard",
  },
  {
    id: "construction",
    text: "a photograph of a construction site, unfinished building or work crew",
  },
  { id: "document", text: "a poster, menu, screenshot, map or printed text" },
];

const runtimes = new Map();
let library;
const transformers = () => (library ||= import("@huggingface/transformers"));
async function decodePhotoImage(bytes, contentType) {
  const [{ RawImage }, { default: sharp }] = await Promise.all([
    transformers(),
    import("sharp"),
  ]);
  // Inspect dimensions before allocating decoded pixels; RawImage uses sharp's
  // larger default pixel limit, which is excessive for an external preview.
  const metadata = await sharp(bytes, {
    limitInputPixels: 40_000_000,
  }).metadata();
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width * metadata.height > 40_000_000
  )
    throw new Error("oversized-image");
  return RawImage.fromBlob(new Blob([bytes], { type: contentType }));
}
// Only pinned model data may be downloaded during explicit bootstrap. Inference
// uses the built-in CLIP implementation and never enables remote executable code.
function runtime({ allowDownload = false, cacheDir } = {}) {
  const cache = resolve(
    cacheDir ||
      process.env.PHOTO_VISION_CACHE_DIR ||
      resolve(root, "work/photo-vision-model-cache"),
  );
  let pending = runtimes.get(cache);
  if (!pending) {
    pending = (async () => {
      const { pipeline, env } = await transformers();
      env.cacheDir = cache;
      env.allowRemoteModels = allowDownload;
      env.allowLocalModels = true;
      try {
        const classifier = await pipeline(
          "zero-shot-image-classification",
          model.id,
          {
            revision: model.revision,
            dtype: model.dtype,
            device: model.device,
            local_files_only: !allowDownload,
            session_options: {
              intraOpNumThreads: Math.min(2, cpus().length),
              interOpNumThreads: 1,
            },
          },
        );
        let queue = Promise.resolve();
        return {
          classify(frame) {
            const operation = queue
              .catch(() => {})
              .then(() =>
                classifier(
                  frame,
                  prompts.map((prompt) => prompt.text),
                  { hypothesis_template: "{}" },
                ),
              );
            queue = operation;
            return operation;
          },
        };
      } finally {
        env.allowRemoteModels = false;
      }
    })();
    runtimes.set(cache, pending);
    void pending.catch(() => {
      if (runtimes.get(cache) === pending) runtimes.delete(cache);
    });
  }
  return pending;
}

/** Explicit CI/bootstrap step; downloads only the pinned model, never images. */
export async function warmLocalPhotoModel(options = {}) {
  await runtime(options);
  return { status: "ready", model: { ...model } };
}

function bounded(operation, signal) {
  if (signal.aborted) return Promise.reject(new Error("review-timeout"));
  return new Promise((accept, reject) => {
    const abort = () => reject(new Error("review-timeout"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(operation)
      .then(accept, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

function magicType(bytes) {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
  )
    return "image/png";
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  if (
    bytes.length >= 16 &&
    bytes.toString("ascii", 4, 8) === "ftyp" &&
    /^(?:avif|avis)$/.test(bytes.toString("ascii", 8, 12))
  )
    return "image/avif";
  return null;
}

function validatedScores(output) {
  if (!Array.isArray(output) || output.length !== prompts.length) return null;
  const scores = output.map((item) => {
    const prompt = prompts.find(
      (prompt) => prompt.id === item?.id || prompt.text === item?.label,
    );
    if (
      !prompt ||
      (item.group && item.group !== groups[prompt.id]) ||
      !Number.isFinite(item.score) ||
      item.score < 0 ||
      item.score > 1
    )
      return null;
    return { id: prompt.id, group: groups[prompt.id], score: item.score };
  });
  if (
    scores.some((item) => !item) ||
    new Set(scores.map((item) => item.id)).size !== prompts.length ||
    Math.abs(scores.reduce((sum, item) => sum + item.score, 0) - 1) >= 1e-5
  )
    return null;
  const bestVenueScore = Math.max(
    ...scores
      .filter((item) => item.group === "venue")
      .map((item) => item.score),
  );
  const bestRejectScore = Math.max(
    ...scores
      .filter((item) => item.group === "reject")
      .map((item) => item.score),
  );
  return {
    model: { ...model },
    ...threshold,
    bestVenueScore,
    bestRejectScore,
    margin: bestVenueScore - bestRejectScore,
    scores,
  };
}

/**
 * Review only opt-in official-provider candidates with completed identity gates.
 * No photograph is stored: original bytes and decoded frames remain in memory.
 * Returns {image, diagnostics}; timeout/unavailable are retryable infrastructure
 * outcomes, rejected is a completed scene decision, ineligible has no safe input.
 */
export function createLocalPhotoReviewer(deps = {}) {
  const download = deps.download || downloadOfficialPhoto;
  let classifier;
  const loadClassifier = () => {
    if (!classifier) {
      const pending = deps.loadClassifier
        ? Promise.resolve().then(() => deps.loadClassifier())
        : runtime().then((loaded) => loaded.classify);
      classifier = pending;
      void pending.catch(() => {
        if (classifier === pending) classifier = undefined;
      });
    }
    return classifier;
  };
  const decodeImage = deps.decodeImage || decodePhotoImage;
  return async (query, officialResult, options = {}) => {
    const diagnostics = {
      status: "ineligible",
      modelStatus: "not-loaded",
      considered: 0,
      attempted: 0,
      reason: "no-eligible-candidates",
      candidates: [],
    };
    /** @param {string} status @param {string} reason @param {import("../../src/domain/models").Place["image"] | null} [image] */
    const finish = (status, reason, image = null) => ({
      image,
      diagnostics: { ...diagnostics, status, reason },
    });
    if (
      Object.keys(options).some(
        (key) => !["signal", "timeoutMs", "maxCandidates"].includes(key),
      ) ||
      (options.timeoutMs !== undefined &&
        (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1)) ||
      (options.maxCandidates !== undefined &&
        (!Number.isInteger(options.maxCandidates) ||
          options.maxCandidates < 1 ||
          options.maxCandidates > 2))
    )
      return finish("ineligible", "unsupported-review-options");
    const identity = officialResult?.identity;
    if (
      !query?.name?.trim() ||
      !identity?.matchedName ||
      !identity.branchSpecific ||
      !(
        identity.matchedArea ||
        identity.matchedAddress ||
        identity.matchedCoordinates
      ) ||
      !safeOfficialPhotoUrl(officialResult.pageUrl || "")
    )
      return finish("ineligible", "unconfirmed-official-identity");
    const seen = new Set();
    const candidates = (
      Array.isArray(officialResult.reviewCandidates)
        ? officialResult.reviewCandidates
        : []
    )
      .filter((candidate) => {
        if (
          !candidate ||
          !safeOfficialPhotoUrl(candidate.url || "") ||
          candidate.source !== officialResult.pageUrl ||
          !["unconfirmed-photo-subject", "unconfirmed-venue-scene"].includes(
            candidate.reason,
          ) ||
          !Array.isArray(candidate.identityEvidence) ||
          !candidate.identityEvidence.length ||
          (identity.multiBranch &&
            !candidate.identityEvidence.includes(
              "image attributed to the local branch",
            )) ||
          candidate.identityEvidence.some(
            (value) =>
              typeof value !== "string" ||
              (!identity.evidence?.includes(value) &&
                !(
                  identity.multiBranch &&
                  value === "image attributed to the local branch"
                )),
          ) ||
          seen.has(candidate.url)
        )
          return false;
        seen.add(candidate.url);
        return true;
      })
      .slice(0, options.maxCandidates || 2);
    diagnostics.considered = candidates.length;
    if (!candidates.length)
      return finish("ineligible", "no-eligible-candidates");
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const timer = setTimeout(
      abort,
      Math.min(12_000, options.timeoutMs || 12_000),
    );
    try {
      let classify;
      try {
        classify = await bounded(loadClassifier(), controller.signal);
        if (typeof classify !== "function")
          throw new Error("invalid-model-runtime");
        diagnostics.modelStatus = "ready";
      } catch {
        diagnostics.modelStatus = "unavailable";
        return finish(
          controller.signal.aborted ? "timeout" : "unavailable",
          "model-unavailable",
        );
      }
      let transientStatus;
      for (const candidate of candidates) {
        diagnostics.attempted++;
        const outcome = {
          imageUrl: candidate.url,
          status: "rejected",
          reason: "invalid-image",
        };
        diagnostics.candidates.push(outcome);
        const imageController = new AbortController();
        const abortImage = () => imageController.abort();
        controller.signal.addEventListener("abort", abortImage, { once: true });
        if (controller.signal.aborted) abortImage();
        const imageTimer = setTimeout(abortImage, 5_000);
        let photo;
        try {
          photo = await bounded(
            download(candidate.url, {
              signal: imageController.signal,
              timeoutMs: 5_000,
            }),
            imageController.signal,
          );
        } catch {
          outcome.reason = "download-timeout-or-network";
          if (controller.signal.aborted)
            return finish("timeout", outcome.reason);
          transientStatus = imageController.signal.aborted
            ? "timeout"
            : "unavailable";
          outcome.status = transientStatus;
          continue;
        } finally {
          clearTimeout(imageTimer);
          controller.signal.removeEventListener("abort", abortImage);
        }
        if (!photo) {
          transientStatus = "unavailable";
          outcome.status = "unavailable";
          outcome.reason = "image-download-unavailable";
          continue;
        }
        const bytes = Buffer.isBuffer(photo.buffer)
          ? photo.buffer
          : Buffer.from(photo.buffer || []);
        const contentType = magicType(bytes);
        if (
          !bytes.length ||
          bytes.length > 8_000_000 ||
          !contentType ||
          photo.contentType !== contentType ||
          !safeOfficialPhotoUrl(photo.url || "")
        )
          continue;
        let frame;
        try {
          frame = await bounded(
            decodeImage(bytes, contentType),
            controller.signal,
          );
          if (
            !Number.isInteger(frame.width) ||
            !Number.isInteger(frame.height) ||
            Math.min(frame.width, frame.height) < 240 ||
            frame.width / frame.height > 4 ||
            frame.height / frame.width > 4 ||
            frame.width * frame.height > 40_000_000
          )
            continue;
        } catch {
          if (controller.signal.aborted)
            return finish("timeout", "review-timeout");
          continue;
        }
        let clip;
        try {
          clip = validatedScores(
            await bounded(classify(frame), controller.signal),
          );
        } catch {
          return finish(
            controller.signal.aborted ? "timeout" : "unavailable",
            "classification-failed",
          );
        }
        if (!clip) return finish("unavailable", "invalid-model-output");
        if (
          clip.bestVenueScore < threshold.minScore ||
          clip.margin < threshold.minMargin
        ) {
          outcome.reason = "scene-threshold-not-met";
          continue;
        }
        const checkedAt = new Date().toISOString();
        const image = approvedPhoto({
          url: candidate.url,
          source: candidate.source,
          credit: query.name,
          license: "Website preview — rights reserved",
          rights: "website-preview",
          strategy: "official-website-preview",
          checkedAt,
          width: frame.width,
          height: frame.height,
          confidence: 0.8,
          matched: [
            ...candidate.identityEvidence,
            "physical venue scene classified by local model",
          ],
          preview: {
            kind: "venue-image",
            pageUrl: candidate.source,
            publisher: query.name,
            identityEvidence: [...candidate.identityEvidence],
            subjectEvidence: ["physical venue scene classified by local model"],
            review: {
              method: "image-analysis:local-clip",
              imageUrl: candidate.url,
              checkedAt,
              sha256: createHash("sha256").update(bytes).digest("hex"),
              description:
                "Offline model classification: generic physical venue scene similarity exceeds the fixed scene threshold and rejection margin. This is not a personal visual review, caption, or verification of venue identity.",
              localClip: clip,
            },
          },
        });
        if (!image) return finish("ineligible", "photo-policy-rejected");
        outcome.status = "accepted";
        outcome.reason = "scene-threshold-met";
        return finish("accepted", "scene-threshold-met", image);
      }
      return finish(
        transientStatus || "rejected",
        transientStatus
          ? "image-download-incomplete"
          : "no-acceptable-venue-scene",
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }
  };
}
