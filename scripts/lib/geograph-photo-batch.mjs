/** Explicit offline Commons resolution; only URL and source evidence are persisted. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { loadProvider } from "./provider-loader.mjs";

const {
  LOCAL_PHOTO_REVIEW_MODEL: model,
  LOCAL_PHOTO_REVIEW_GROUPS: groups,
  LOCAL_PHOTO_REVIEW_THRESHOLD: threshold,
} = loadProvider("src/providers/photo-policy.ts");

const DAY = 86400000;
const VERSION = "geograph-commons-v3";
const SOURCE_ROOT = "https://data.geograph.org.uk/dumps/";
const LICENSE_URL = "https://creativecommons.org/licenses/by-sa/2.0/";
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const integer = (value, fallback, max, name, minimum = 0) => {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(result) || result < minimum || result > max)
    throw new Error(`Invalid ${name}: expected ${minimum}–${max}`);
  return result;
};
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const normalize = (value) =>
  value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\p{M}/gu, "")
    .replace(/[&+]/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
const venueName = (value) => normalize(value).replace(/^the /, "");
const nonphysical =
  /\b(?:demolished|demolition|construction site|under construction|artists? impression|logo|map of|postcard|painting of|drawing of|signboard|car park|parking)\b/i;
function distanceMetres(a, b) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) *
      Math.cos(b.lat * rad) *
      Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
function validQuery(query, osmOnly = false) {
  return (
    query &&
    typeof query.id === "string" &&
    query.id.length > 0 &&
    query.id.length <= 200 &&
    !/[\x00-\x1f]/.test(query.id) &&
    (!osmOnly || /^osm-(?:node|way|relation)-[1-9]\d*$/.test(query.id)) &&
    typeof query.name === "string" &&
    query.name.trim() &&
    query.name.length <= 200 &&
    finite(query.lat) &&
    Math.abs(query.lat) <= 90 &&
    finite(query.lng) &&
    Math.abs(query.lng) <= 180
  );
}
function validateCandidates(input, identity) {
  if (
    input?.version !== 1 ||
    input.status !== "candidates" ||
    !Array.isArray(input.entries) ||
    input.entries.length > 100000
  )
    throw new Error("Invalid Geograph candidate metadata");
  const criteria = input.criteria;
  if (
    input.license !== "CC BY-SA 2.0" ||
    input.licenseUrl !== LICENSE_URL ||
    criteria?.maximumDistanceMetres !== 150 ||
    criteria.minimumSubjectGridDigits !== 8 ||
    criteria.maximumPerVenue !== 3 ||
    criteria.requireUnrestrictedSubjectPosition !== true
  )
    throw new Error("Unverified Geograph candidate criteria");
  const expected = new Set([
    `${SOURCE_ROOT}gridimage_base.tsv.gz`,
    `${SOURCE_ROOT}gridimage_geo.tsv.gz`,
  ]);
  if (!Array.isArray(input.sources) || input.sources.length !== 2)
    throw new Error("Missing Geograph source provenance");
  for (const source of input.sources) {
    if (
      !expected.delete(source.url) ||
      !/^[a-f0-9]{64}$/.test(source.sha256) ||
      !Number.isSafeInteger(source.compressedBytes) ||
      source.compressedBytes <= 0 ||
      source.compressedBytes > 512 * 1024 ** 2
    )
      throw new Error("Invalid Geograph source provenance");
  }
  const seen = new Set();
  for (const entry of input.entries) {
    if (!validQuery(entry.query, true))
      throw new Error("Invalid Geograph venue identity");
    const key = identity(entry.query);
    if (
      entry.identity !== key ||
      seen.has(key) ||
      !Array.isArray(entry.candidates) ||
      !entry.candidates.length ||
      entry.candidates.length > 3
    )
      throw new Error("Invalid or duplicate Geograph venue candidates");
    seen.add(key);
    const ids = new Set();
    const name = venueName(entry.query.name);
    for (const candidate of entry.candidates) {
      const proof = candidate.evidence;
      const point = candidate.coordinates;
      if (
        candidate.status !== "candidate" ||
        !Number.isSafeInteger(candidate.geographId) ||
        candidate.geographId <= 0 ||
        ids.has(candidate.geographId) ||
        candidate.pageUrl !==
          `https://www.geograph.org.uk/photo/${candidate.geographId}` ||
        candidate.license !== "CC BY-SA 2.0" ||
        candidate.licenseUrl !== LICENSE_URL ||
        typeof candidate.title !== "string" ||
        candidate.title.length > 1000 ||
        !` ${normalize(candidate.title)} `.includes(` ${name} `) ||
        !candidate.photographer?.trim() ||
        candidate.photographer.length > 300 ||
        !Number.isSafeInteger(candidate.photographerId) ||
        candidate.photographerId <= 0 ||
        typeof candidate.photoTaken !== "string" ||
        candidate.photoTaken.length > 10 ||
        !point ||
        !finite(point.lat) ||
        Math.abs(point.lat) > 90 ||
        !finite(point.lng) ||
        Math.abs(point.lng) > 180 ||
        ![8, 10].includes(candidate.subjectPrecision?.digits) ||
        candidate.subjectPrecision.metres !==
          (candidate.subjectPrecision.digits === 8 ? 10 : 1) ||
        proof?.normalizedVenueName !== name ||
        proof.nameMatch !== "full-normalized-phrase" ||
        proof.coordinateRole !== "subject" ||
        proof.uniqueNearbyVenue !== true ||
        !finite(proof.distanceMetres) ||
        proof.distanceMetres < 0 ||
        proof.distanceMetres > 150 ||
        distanceMetres(entry.query, point) > 150 ||
        Math.abs(distanceMetres(entry.query, point) - proof.distanceMetres) >
          0.02
      )
        throw new Error(
          "Invalid Geograph candidate subject, source, venue or precision evidence",
        );
      ids.add(candidate.geographId);
    }
  }
  return input;
}

export async function readGeographCandidates(file) {
  const information = await stat(file);
  if (information.size > 50 * 1024 ** 2)
    throw new Error("Geograph candidate metadata exceeds compressed quota");
  const data = JSON.parse(
    gunzipSync(await readFile(file), {
      maxOutputLength: 128 * 1024 ** 2,
    }).toString("utf8"),
  );
  if (
    data?.version !== 1 ||
    data.status !== "candidates" ||
    !Array.isArray(data.entries)
  )
    throw new Error("Invalid Geograph candidate metadata");
  return data;
}
async function atomicJson(file, value) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.partial`;
  let handle;
  try {
    handle = await open(temporary, "wx");
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, file);
    const directory = await open(dirname(file), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await handle?.close();
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
function fingerprint(entry) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: VERSION,
        query: entry.query,
        candidates: entry.candidates,
      }),
    )
    .digest("hex");
}
function recentCapture(value, now) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) return false;
  const [, year, month, day] = parts.map(Number);
  if (year < 1 || month > 12 || day > 31 || (!month && day)) return false;
  const date = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  if (
    date.getUTCFullYear() !== year ||
    (month && date.getUTCMonth() !== month - 1) ||
    (day && date.getUTCDate() !== day)
  )
    return false;
  const earliest = date.getTime();
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 10);
  return earliest >= cutoff.getTime() && earliest <= now;
}
function photoFromResult(result, candidate, approvedPhoto, checkedAt) {
  const evidence = result?.evidence;
  const id = String(candidate.geographId);
  const image = result?.image;
  if (
    !image ||
    result.reason !== "matched" ||
    evidence?.geographId !== id ||
    evidence.sourceUrl !== candidate.pageUrl ||
    !Array.isArray(evidence.structuredIds) ||
    evidence.structuredIds.some((value) => value !== id) ||
    evidence.warnings?.includes("bulk-title-needs-review") ||
    // Captions may explain nearby parking after identifying the venue subject.
    // Keep ancillary notes from overriding the actual subject in the first sentence.
    nonphysical.test(
      normalize((evidence.description || "").split(/[.!?\n]/, 1)[0]),
    ) ||
    ![image.width, image.height].every(
      (size) => Number.isInteger(size) && size >= 240 && size <= 40000,
    ) ||
    image.width / image.height > 4 ||
    image.height / image.width > 4 ||
    image.strategy !== "geograph-commons-source-id" ||
    image.rights !== "open"
  )
    return null;
  // Never serialize arbitrary provider diagnostics, HTML, byte buffers or credentials.
  return (
    approvedPhoto(
      {
        url: image.url,
        source: image.source,
        credit: image.credit,
        license: image.license,
        rights: "open",
        strategy: "geograph-commons-source-id",
        checkedAt,
        width: image.width,
        height: image.height,
        confidence: 0.9,
        matched: [
          "exact-geograph-source-id",
          "full venue name in Geograph subject title",
          "precise Geograph subject position within 150m",
        ],
      },
      checkedAt,
    ) || null
  );
}
function sceneProof(review, image, checkedAt) {
  const clip = review?.localClip;
  if (
    review?.accepted !== true ||
    !/^[a-f0-9]{64}$/.test(review.sha256 || "") ||
    ![review.width, review.height].every(
      (size) => Number.isInteger(size) && size >= 240 && size <= 40000,
    ) ||
    review.width * review.height > 40000000 ||
    review.width / review.height > 4 ||
    review.height / review.width > 4 ||
    !clip ||
    !clip.model ||
    Object.entries(model).some(([key, value]) => clip.model[key] !== value) ||
    clip.minScore !== threshold.minScore ||
    clip.minMargin !== threshold.minMargin ||
    !Array.isArray(clip.scores) ||
    clip.scores.length !== Object.keys(groups).length ||
    new Set(clip.scores.map((score) => score?.id)).size !==
      clip.scores.length ||
    clip.scores.some(
      (score) =>
        !score ||
        !Object.hasOwn(groups, score.id) ||
        groups[score.id] !== score.group ||
        !finite(score.score) ||
        score.score < 0 ||
        score.score > 1,
    )
  )
    return null;
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
  if (
    Math.abs(clip.scores.reduce((sum, score) => sum + score.score, 0) - 1) >
      1e-5 ||
    venue < threshold.minScore ||
    margin < threshold.minMargin ||
    Math.abs(clip.bestVenueScore - venue) > 1e-9 ||
    Math.abs(clip.bestRejectScore - reject) > 1e-9 ||
    Math.abs(clip.margin - margin) > 1e-9 ||
    ![clip.bestVenueScore, clip.bestRejectScore, clip.margin].every(finite)
  )
    return null;
  return {
    method: "image-analysis:local-clip",
    imageUrl: image.url,
    checkedAt,
    sha256: review.sha256,
    width: review.width,
    height: review.height,
    localClip: {
      model: { ...model },
      ...threshold,
      bestVenueScore: venue,
      bestRejectScore: reject,
      margin,
      scores: clip.scores.map(({ id, group, score }) => ({ id, group, score })),
    },
  };
}
const fresh = (value, now, ttl) => {
  const age = now - Date.parse(value);
  return Number.isFinite(age) && age >= 0 && age < ttl;
};

/** Shares the official photo job's .lock; every completed venue is a durable checkpoint. */
export async function runGeographPhotoBatch(options, providers) {
  const {
    approvedPhoto,
    websiteDiscoveryIdentity,
    resolveGeographCommonsPhoto,
    reviewPhotograph,
    now = Date.now,
    pause = sleep,
    onOutcome = () => {},
  } = providers;
  if (typeof reviewPhotograph !== "function")
    throw new Error("Local photograph review is required");
  const input = validateCandidates(
    options.candidates,
    websiteDiscoveryIdentity,
  );
  const limit = integer(options.limit, 100, 1000, "limit");
  const maxRuntimeMs = integer(
    options.maxRuntimeMs,
    1200000,
    1200000,
    "maxRuntimeMs",
    1000,
  );
  const timeoutMs = integer(options.timeoutMs, 6500, 15000, "timeoutMs", 1);
  const output = resolve(
    options.output || "src/providers/data/venue-photo-previews.json",
  );
  await mkdir(dirname(output), { recursive: true });
  let lock;
  try {
    lock = await open(`${output}.lock`, "wx");
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error(
        "Venue photo preparation lock exists; earlier job must finish first",
      );
    throw error;
  }
  try {
    await lock.writeFile(
      `${JSON.stringify({ pid: process.pid, createdAt: new Date(now()).toISOString() })}\n`,
    );
    await lock.sync();
    let manifest;
    try {
      manifest = JSON.parse(await readFile(output, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      manifest = { version: 1, entries: [] };
    }
    if (manifest?.version !== 1 || !Array.isArray(manifest.entries))
      throw new Error("Invalid existing venue photo manifest");
    const entries = new Map();
    for (const entry of manifest.entries) {
      if (!validQuery(entry.query))
        throw new Error("Invalid existing venue identity");
      const key = websiteDiscoveryIdentity(entry.query);
      const existing = entries.get(key);
      if (
        !approvedPhoto(existing?.image, existing?.checkedAt) ||
        approvedPhoto(entry.image, entry.checkedAt)
      )
        entries.set(key, entry);
    }
    const report = {
      processed: 0,
      matched: 0,
      unresolved: 0,
      retryable: 0,
      existing: 0,
      cached: 0,
      requests: 0,
      reviewed: 0,
      timeBudgetExhausted: false,
      rateLimited: false,
    };
    const began = now(),
      wallBegan = performance.now();
    const remaining = () =>
      Math.max(
        0,
        Math.floor(
          Math.min(
            maxRuntimeMs - (now() - began),
            maxRuntimeMs - (performance.now() - wallBegan),
          ),
        ),
      );
    const checkpoint = async () => {
      manifest.generatedAt = new Date(now()).toISOString();
      manifest.entries = [...entries.values()];
      await atomicJson(output, manifest);
    };
    const queue = [...input.entries].sort(
      (a, b) =>
        (Date.parse(entries.get(a.identity)?.geograph?.checkedAt) || 0) -
        (Date.parse(entries.get(b.identity)?.geograph?.checkedAt) || 0),
    );
    let lookupStarted = false;
    for (const entry of queue) {
      const key = websiteDiscoveryIdentity(entry.query),
        prior = entries.get(key),
        current = now();
      if (approvedPhoto(prior?.image, prior?.checkedAt)) {
        report.existing++;
        continue;
      }
      const sourceFingerprint = fingerprint(entry);
      if (
        !options.refresh &&
        prior?.geograph?.reason !== "batch-deadline" &&
        prior?.geograph?.fingerprint === sourceFingerprint &&
        fresh(
          prior.geograph.checkedAt,
          current,
          prior.geograph.retryable || prior.deliveryFailure ? DAY : 30 * DAY,
        )
      ) {
        report.cached++;
        continue;
      }
      if (report.processed >= limit) break;
      if (!remaining()) {
        report.timeBudgetExhausted = true;
        break;
      }
      const checkedAt = new Date(current).toISOString();
      let image = null,
        selected = null,
        vision = null,
        retryable = false,
        reason = "no-eligible-photo",
        retryAfterMs;
      const attempts = [];
      for (const candidate of entry.candidates) {
        if (
          !recentCapture(candidate.photoTaken, current) ||
          nonphysical.test(normalize(candidate.title))
        ) {
          attempts.push({
            geographId: candidate.geographId,
            reason: "dated-or-nonphysical-subject",
          });
          continue;
        }
        if (lookupStarted) {
          if (remaining() <= 200) {
            report.timeBudgetExhausted = true;
            retryable = true;
            reason = "batch-deadline";
            break;
          }
          await pause(200);
        }
        const budget = Math.min(timeoutMs, remaining());
        if (!budget) {
          report.timeBudgetExhausted = true;
          retryable = true;
          reason = "batch-deadline";
          break;
        }
        lookupStarted = true;
        const controller = new AbortController();
        let timer;
        let response;
        try {
          response = await Promise.race([
            Promise.resolve().then(() =>
              resolveGeographCommonsPhoto(candidate.geographId, {
                signal: controller.signal,
                timeoutMs: budget,
                checkedAt,
                expectedTitle: candidate.title,
                expectedPhotographer: candidate.photographer,
              }),
            ),
            new Promise((_, reject) => {
              timer = setTimeout(() => {
                controller.abort();
                reject(new Error("deadline-exceeded"));
              }, budget);
            }),
          ]);
        } catch {
          response = {
            image: null,
            reason: "deadline-exceeded",
            retryable: true,
            requestCount: 0,
          };
        } finally {
          clearTimeout(timer);
        }
        report.requests +=
          Number.isInteger(response?.requestCount) &&
          response.requestCount >= 0 &&
          response.requestCount <= 7
            ? response.requestCount
            : 0;
        reason =
          typeof response?.reason === "string"
            ? response.reason.slice(0, 100)
            : "invalid-result";
        retryable ||= Boolean(response?.retryable);
        attempts.push({ geographId: candidate.geographId, reason });
        const sourceImage = photoFromResult(
          response,
          candidate,
          approvedPhoto,
          checkedAt,
        );
        if (sourceImage) {
          const reviewController = new AbortController();
          let reviewTimer;
          const reviewBudget = Math.min(12000, remaining());
          let review;
          if (!reviewBudget) {
            report.timeBudgetExhausted = true;
            retryable = true;
            reason = "batch-deadline";
            break;
          }
          try {
            report.reviewed++;
            review = await Promise.race([
              Promise.resolve().then(() =>
                reviewPhotograph(sourceImage, {
                  signal: reviewController.signal,
                  timeoutMs: reviewBudget,
                }),
              ),
              new Promise((_, reject) => {
                reviewTimer = setTimeout(() => {
                  reviewController.abort();
                  reject(new Error("review-timeout"));
                }, reviewBudget);
              }),
            ]);
          } catch {
            review = {
              accepted: false,
              diagnostics: { status: "unavailable" },
            };
          } finally {
            clearTimeout(reviewTimer);
          }
          vision = sceneProof(review, sourceImage, checkedAt);
          if (vision) {
            image = {
              ...sourceImage,
              width: vision.width,
              height: vision.height,
            };
            selected = candidate;
            reason = "matched";
            retryable = false;
            break;
          }
          const status = review?.diagnostics?.status;
          reason =
            status === "rejected"
              ? "photo-review-rejected"
              : "photo-review-unavailable";
          retryable ||= status !== "rejected";
          attempts.at(-1).reason = reason;
          continue;
        }
        if (response?.image) reason = "candidate-metadata-rejected";
        if (
          response?.retryAfterMs ||
          /^(?:http-(?:429|503)|api-(?:maxlag|ratelimited|readonly|cirrussearch-too-busy-error))$/.test(
            reason,
          )
        ) {
          retryAfterMs = finite(response.retryAfterMs)
            ? Math.max(1000, Math.min(300000, response.retryAfterMs))
            : 60000;
          report.rateLimited = true;
          retryable = true;
          break;
        }
      }
      const geograph = {
        version: VERSION,
        fingerprint: sourceFingerprint,
        checkedAt,
        status: image ? "matched" : retryable ? "retryable" : "unresolved",
        reason,
        retryable,
        attempts,
        ...(retryAfterMs
          ? { retryAfter: new Date(current + retryAfterMs).toISOString() }
          : {}),
        ...(selected
          ? {
              geographId: selected.geographId,
              title: selected.title,
              photographer: selected.photographer,
              photoTaken: selected.photoTaken,
              subjectPrecision: selected.subjectPrecision,
              sourceUrl: selected.pageUrl,
              distanceMetres: selected.evidence.distanceMetres,
            }
          : {}),
      };
      const next = {
        ...(prior || {
          query: entry.query,
          checkedAt,
          image: null,
          website: { urls: [], status: "no-match", source: "none" },
          status: retryable ? "retryable" : "unresolved",
          retryable,
        }),
        ...(image
          ? {
              query: prior?.query || entry.query,
              checkedAt,
              image,
              status: "matched",
              retryable: false,
              evidence: { ...(prior?.evidence || {}), vision },
            }
          : {}),
        geograph,
      };
      if (image) {
        delete next.deliveryVerifiedAt;
        delete next.deliveryFailure;
      }
      entries.set(key, next);
      await checkpoint();
      report.processed++;
      if (image) report.matched++;
      else if (retryable) report.retryable++;
      else report.unresolved++;
      await onOutcome({
        id: entry.query.id,
        name: entry.query.name,
        status: geograph.status,
        reason,
        geographId: selected?.geographId,
      });
      if (!remaining()) report.timeBudgetExhausted = true;
      if (report.rateLimited || report.timeBudgetExhausted) break;
    }
    if (!report.processed) await checkpoint();
    return report;
  } finally {
    await lock.close();
    await unlink(`${output}.lock`);
  }
}
