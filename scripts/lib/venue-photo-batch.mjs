/** Offline, metadata-only preparation. This module is never imported by the app. */
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const DAY = 86400000;
export const SEARCH_CACHE_MS = 30 * DAY;
const PHOTO_CACHE_MS = 30 * DAY;
const PHOTO_RETRY_MS = DAY;
const SEARCH_STATUSES = new Set(["found", "no-match", "unavailable"]);

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

/** The reservation is fsynced before any provider request can spend a credit. */
async function atomicJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.partial`;
  let handle;
  try {
    handle = await open(temporary, "wx");
    await handle.writeFile(JSON.stringify(value, null, 2) + "\n");
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

async function withLocks(files, now, task) {
  const held = [];
  try {
    for (const file of [
      ...new Set(files.map((file) => `${resolve(file)}.lock`)),
    ].sort()) {
      await mkdir(dirname(file), { recursive: true });
      let handle;
      try {
        handle = await open(file, "wx");
      } catch (error) {
        if (error.code === "EEXIST")
          throw new Error(
            `Venue photo preparation lock exists: ${file}. Remove it only after checking that the earlier job has stopped.`,
          );
        throw error;
      }
      held.push({ file, handle });
      await handle.writeFile(
        JSON.stringify({
          pid: process.pid,
          createdAt: new Date(now()).toISOString(),
        }) + "\n",
      );
      await handle.sync();
    }
    return await task();
  } finally {
    for (const { file, handle } of held.reverse()) {
      await handle.close();
      await unlink(file);
    }
  }
}

const integer = (value, fallback, max, name) => {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(result) || result < 0 || result > max)
    throw new Error(`Invalid ${name}: expected an integer from 0 to ${max}`);
  return result;
};
const text = (value, max = 300) =>
  typeof value === "string" ? value.slice(0, max) : null;
const strings = (values) =>
  Array.isArray(values)
    ? values
        .filter((value) => typeof value === "string" && value)
        .slice(0, 20)
        .map((value) => value.slice(0, 300))
    : [];
const counts = (values) =>
  Object.fromEntries(
    Object.entries(values && typeof values === "object" ? values : {})
      .filter(([, value]) => Number.isInteger(value) && value > 0)
      .slice(0, 80)
      .map(([key, value]) => [key.slice(0, 120), value]),
  );
const fresh = (checkedAt, now, ttl) => {
  const age = now - Date.parse(checkedAt);
  return Number.isFinite(age) && age >= 0 && age < ttl;
};

function websiteUrls(values, safeOfficialPhotoUrl) {
  const urls = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== "string") continue;
    const https = value.replace(/^http:\/\//i, "https://");
    if (!safeOfficialPhotoUrl(https)) continue;
    const url = new URL(https);
    url.hash = "";
    if (!urls.includes(url.href)) urls.push(url.href);
    if (urls.length === 3) break;
  }
  return urls;
}

// Normalized OSM records fall back to their map source as `website`.
// These are useful provenance links but cannot stand in for an official site.
const directories =
  /(?:^|\.)(?:facebook\.com|instagram\.com|tiktok\.com|tripadvisor\.[a-z.]+|yelp\.[a-z.]+|google\.[a-z.]+|openstreetmap\.org|dayoutwiththekids\.co\.uk|netmums\.com|wikipedia\.org|yell\.com)$/i;
const officialWebsites = (values, safeOfficialPhotoUrl) =>
  websiteUrls(values, safeOfficialPhotoUrl).filter(
    (value) => !directories.test(new URL(value).hostname),
  );

/** Explicit allowlists prevent provider HTML, downloaded buffers or secrets being serialized. */
function photoMetadata(image) {
  if (!image) return null;
  const saved = {};
  for (const key of [
    "url",
    "source",
    "credit",
    "license",
    "rights",
    "strategy",
    "checkedAt",
  ])
    if (typeof image[key] === "string") saved[key] = image[key];
  for (const key of ["width", "height", "confidence"])
    if (Number.isFinite(image[key])) saved[key] = image[key];
  if (image.matched) saved.matched = strings(image.matched);
  if (image.preview)
    saved.preview = {
      pageUrl: image.preview.pageUrl,
      publisher: image.preview.publisher,
      kind: image.preview.kind,
      identityEvidence: strings(image.preview.identityEvidence),
      subjectEvidence: strings(image.preview.subjectEvidence),
      ...(image.preview.review
        ? {
            review: {
              ...Object.fromEntries(
                [
                  "method",
                  "provider",
                  "imageUrl",
                  "checkedAt",
                  "description",
                  "sha256",
                ]
                  .filter(
                    (key) => typeof image.preview.review[key] === "string",
                  )
                  .map((key) => [key, image.preview.review[key]]),
              ),
              ...(image.preview.review.localClip
                ? {
                    localClip: localClipMetadata(
                      image.preview.review.localClip,
                    ),
                  }
                : {}),
            },
          }
        : {}),
    };
  return saved;
}

function localClipMetadata(clip) {
  return {
    model: Object.fromEntries(
      ["id", "revision", "dtype", "device", "library", "libraryVersion"]
        .filter((key) => typeof clip.model?.[key] === "string")
        .map((key) => [key, clip.model[key].slice(0, 300)]),
    ),
    ...Object.fromEntries(
      ["minScore", "minMargin", "bestVenueScore", "bestRejectScore", "margin"]
        .filter((key) => Number.isFinite(clip[key]))
        .map((key) => [key, clip[key]]),
    ),
    scores: (Array.isArray(clip.scores) ? clip.scores : [])
      .slice(0, 9)
      .filter(
        (score) =>
          typeof score?.id === "string" &&
          ["venue", "reject"].includes(score.group) &&
          Number.isFinite(score.score),
      )
      .map((score) => ({
        id: score.id.slice(0, 100),
        group: score.group,
        score: score.score,
      })),
  };
}

function visionMetadata(vision) {
  if (!vision || typeof vision !== "object") return {};
  return {
    ...Object.fromEntries(
      ["status", "modelStatus", "reason"]
        .filter((key) => typeof vision[key] === "string")
        .map((key) => [key, text(vision[key])]),
    ),
    ...Object.fromEntries(
      ["count", "considered", "attempted"]
        .filter(
          (key) =>
            Number.isInteger(vision[key]) &&
            vision[key] >= 0 &&
            vision[key] <= 1000,
        )
        .map((key) => [key, vision[key]]),
    ),
  };
}

function previewEvidence(website, result, safeOfficialPhotoUrl) {
  const source = result?.result ?? {};
  const identity = source.identity ?? {};
  return {
    website,
    pageUrl: websiteUrls([source.pageUrl], safeOfficialPhotoUrl)[0] ?? null,
    reason:
      text(source.reason) ?? (result?.retryable ? "website-unavailable" : null),
    retryable: Boolean(result?.retryable),
    requestCount: integer(source.requestCount, 0, 1000, "requestCount"),
    identity: {
      matchedName: identity.matchedName === true,
      matchedArea: identity.matchedArea === true,
      matchedAddress: identity.matchedAddress === true,
      multiBranch: identity.multiBranch === true,
      branchSpecific: identity.branchSpecific === true,
      evidence: strings(identity.evidence),
    },
    rejected: counts(source.rejected),
    ...(source.vision ? { vision: visionMetadata(source.vision) } : {}),
    candidates: (Array.isArray(source.candidates) ? source.candidates : [])
      .slice(0, 12)
      .flatMap((candidate) => {
        const url = websiteUrls([candidate?.url], safeOfficialPhotoUrl)[0];
        return url
          ? [
              {
                url,
                source:
                  websiteUrls([candidate.source], safeOfficialPhotoUrl)[0] ??
                  null,
                photoScore: Number.isFinite(candidate.photoScore)
                  ? candidate.photoScore
                  : null,
                evidence: strings(candidate.evidence),
                subjectEvidence: strings(candidate.subjectEvidence),
              },
            ]
          : [];
      }),
  };
}

function validateFiles(manifest, ledger) {
  if (manifest?.version !== 1 || !Array.isArray(manifest.entries))
    throw new Error(
      "Invalid venue photo preview manifest; refusing to overwrite it",
    );
  if (
    ledger?.version !== 1 ||
    !ledger.months ||
    typeof ledger.months !== "object" ||
    Array.isArray(ledger.months)
  )
    throw new Error(
      "Invalid search ledger; refusing to reset the monthly budget",
    );
  for (const [month, record] of Object.entries(ledger.months)) {
    if (!/^\d{4}-\d{2}$/.test(month) || !Array.isArray(record?.attempts))
      throw new Error(
        "Invalid search ledger month; refusing to reset the monthly budget",
      );
    for (const attempt of record.attempts)
      if (
        typeof attempt.venueKey !== "string" ||
        !Number.isFinite(Date.parse(attempt.reservedAt)) ||
        !["reserved", ...SEARCH_STATUSES].includes(attempt.status)
      )
        throw new Error(
          "Invalid search reservation; refusing to reset the monthly budget",
        );
  }
}

/** Sequential by design: each outcome and each quota reservation is a durable checkpoint. */
export async function runVenuePhotoBatch(options, providers) {
  const {
    placePhotoQuery,
    websiteDiscoveryIdentity,
    safeOfficialPhotoUrl,
    approvedPhoto,
    resolveOfficialWebsitePreview,
    searchOfficialWebsite,
    now = Date.now,
    onOutcome = () => {},
  } = providers;
  const output = resolve(
    options.output ?? "src/providers/data/venue-photo-previews.json",
  );
  const ledgerPath = resolve(
    options.ledger ?? "src/providers/data/venue-photo-search-ledger.json",
  );
  if (output === ledgerPath)
    throw new Error(
      "The preview manifest and search ledger must use different files",
    );
  const limit = integer(options.limit, 100, 1000, "limit");
  const maxRuntimeMs = integer(
    options.maxRuntimeMs,
    1200000,
    1200000,
    "maxRuntimeMs",
  );
  if (maxRuntimeMs < 1000)
    throw new Error(
      "Invalid maxRuntimeMs: expected an integer from 1000 to 1200000",
    );
  const reviewVersion = options.reviewVersion ?? "metadata-v1";
  if (
    typeof reviewVersion !== "string" ||
    !reviewVersion.trim() ||
    reviewVersion.length > 100
  )
    throw new Error(
      "Invalid reviewVersion: expected a nonempty string up to 100 characters",
    );
  const maxSearches = integer(options.maxSearches, 0, 1000, "maxSearches");
  const monthlyCap = integer(options.monthlyCap, 1000, 1000, "monthlyCap");
  const timeoutMs = Math.max(
    1,
    integer(options.timeoutMs, 12000, 12000, "timeoutMs"),
  );
  if (!Array.isArray(options.places))
    throw new Error("Expected an array of normalized places");
  const unique = new Map();
  for (const place of options.places) {
    // Supplied, policy-approved photography already covers this venue. Avoid
    // spending discovery work on seed photos while unresolved venues wait.
    if (approvedPhoto(place.image)) continue;
    const query = placePhotoQuery(place);
    if (
      !query?.name?.trim() ||
      query.name.length > 200 ||
      !Number.isFinite(query.lat) ||
      !Number.isFinite(query.lng) ||
      Math.abs(query.lat) > 90 ||
      Math.abs(query.lng) > 180
    )
      throw new Error("Invalid normalized place in photo preparation input");
    unique.set(websiteDiscoveryIdentity(query), query);
  }
  const began = now();
  const wallBegan = performance.now();
  const remainingMs = () =>
    Math.max(
      0,
      Math.floor(
        Math.min(
          maxRuntimeMs - (now() - began),
          maxRuntimeMs - (performance.now() - wallBegan),
        ),
      ),
    );
  return withLocks([output, ledgerPath], now, async () => {
    const manifest = await readJson(output, {
      version: 1,
      generatedAt: null,
      entries: [],
    });
    const ledger = await readJson(ledgerPath, { version: 1, months: {} });
    validateFiles(manifest, ledger);
    const entries = new Map();
    for (const entry of manifest.entries) {
      const key = websiteDiscoveryIdentity(entry.query);
      const existing = entries.get(key);
      // Align with the runtime's stable venue key. Older manifests may have
      // duplicate rows after alias/source enrichment; retain their valid photo.
      if (
        existing &&
        approvedPhoto(existing.image, existing.checkedAt) &&
        !approvedPhoto(entry.image, entry.checkedAt)
      )
        continue;
      entries.set(key, entry);
    }
    const discovered = new Map(
      [...entries.values()].map((entry) => [
        websiteDiscoveryIdentity(entry.query),
        entry.website,
      ]),
    );
    const reservations = new Map();
    for (const record of Object.values(ledger.months))
      for (const attempt of record.attempts) {
        const prior = reservations.get(attempt.venueKey);
        if (
          !prior ||
          Date.parse(attempt.reservedAt) > Date.parse(prior.reservedAt)
        )
          reservations.set(attempt.venueKey, attempt);
      }
    const report = {
      processed: 0,
      matched: 0,
      unresolved: 0,
      retryable: 0,
      searchSkipped: 0,
      searches: 0,
      cached: 0,
      timeBudgetExhausted: false,
    };
    const boundedProvider = async (provider, requestedTimeoutMs) => {
      const remaining = remainingMs();
      if (!remaining) {
        report.timeBudgetExhausted = true;
        throw new Error("Venue photo batch runtime exhausted");
      }
      const budget = Math.min(remaining, requestedTimeoutMs);
      const controller = new AbortController();
      let timer;
      try {
        return await Promise.race([
          Promise.resolve().then(() =>
            provider({ timeoutMs: budget, signal: controller.signal }),
          ),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              if (budget === remaining) report.timeBudgetExhausted = true;
              controller.abort();
              reject(new Error("Venue photo provider timeout"));
            }, budget);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    const checkpoint = async () => {
      manifest.generatedAt = new Date(now()).toISOString();
      manifest.entries = [...entries.values()];
      await atomicJson(output, manifest);
    };
    const canSearch = Boolean(
      options.searchEnabled &&
      maxSearches > 0 &&
      (ledger.months[new Date(now()).toISOString().slice(0, 7)]?.attempts
        .length ?? 0) < monthlyCap,
    );
    // A large OSM catalogue starts with many records without official sites.
    // Spend the limited batch on usable unresolved sources first, then visit
    // the least recently attempted work so repeated maintenance keeps moving.
    const queue = [...unique]
      .map(([key, query], order) => {
        const prior = entries.get(key);
        const cached = discovered.get(websiteDiscoveryIdentity(query));
        const hasWebsite =
          officialWebsites(
            [query.website, ...(cached?.urls ?? [])],
            safeOfficialPhotoUrl,
          ).length > 0;
        const hasImage = Boolean(approvedPhoto(prior?.image, prior?.checkedAt));
        return {
          key,
          query,
          order,
          priority: hasImage
            ? 3
            : hasWebsite
              ? prior &&
                (prior.reviewVersion ?? "metadata-v1") !== reviewVersion
                ? 0
                : 1
              : canSearch
                ? 2
                : 4,
          attemptedAt: Math.max(
            Date.parse(prior?.checkedAt) || 0,
            Date.parse(prior?.refreshFailure?.at) || 0,
          ),
        };
      })
      .sort(
        (a, b) =>
          a.priority - b.priority ||
          a.attemptedAt - b.attemptedAt ||
          a.order - b.order,
      );
    for (const { key, query } of queue) {
      const prior = entries.get(key);
      const current = now();
      const priorImage = approvedPhoto(prior?.image, prior?.checkedAt);
      const sameSource = [
        "website",
        "area",
        "address",
        "postcode",
        "aliases",
        "wikidata",
        "wikipedia",
        "osmImage",
        "commons",
      ].every(
        (field) =>
          JSON.stringify(prior?.query?.[field]) ===
          JSON.stringify(query[field]),
      );
      if (
        !options.refresh &&
        prior &&
        prior.evidence?.reason !== "website-preview-pending" &&
        prior.refreshFailure?.evidence?.reason !== "website-preview-pending" &&
        (prior.status !== "search-skipped" || !canSearch) &&
        (priorImage ||
          (prior.reviewVersion ?? "metadata-v1") === reviewVersion) &&
        (priorImage || sameSource) &&
        fresh(
          prior.refreshFailure?.at ?? prior.checkedAt,
          current,
          prior.retryable ? PHOTO_RETRY_MS : PHOTO_CACHE_MS,
        )
      ) {
        report.cached++;
        continue;
      }
      if (report.processed >= limit) break;
      if (!remainingMs() || report.timeBudgetExhausted) {
        report.timeBudgetExhausted = true;
        break;
      }
      const checkedAt = new Date(current).toISOString();
      const venueKey = websiteDiscoveryIdentity(query);
      const mappedUrls = officialWebsites(
        [query.website],
        safeOfficialPhotoUrl,
      );
      let website = {
        urls: mappedUrls,
        status: mappedUrls.length ? "found" : "disabled",
        source: mappedUrls.length ? "mapped" : "none",
      };
      let searchSkipped = false;
      if (!mappedUrls.length) {
        const cached = discovered.get(venueKey);
        const reservation = reservations.get(venueKey);
        // Older artifacts cannot shorten the minimum cooldown by omitting an expiry.
        // Future reservations also stay protected if a local clock moves backwards.
        const searchedAt = Date.parse(cached?.searchedAt);
        const cacheExpiry = Math.max(
          searchedAt + SEARCH_CACHE_MS,
          Date.parse(cached?.searchExpiresAt) || 0,
        );
        const searchFresh =
          cached?.source === "tavily" &&
          Number.isFinite(searchedAt) &&
          cacheExpiry > current;
        const preparedUrls =
          cached?.status === "found" &&
          ["mapped", "tavily"].includes(cached.source)
            ? officialWebsites(cached.urls, safeOfficialPhotoUrl)
            : [];
        // Positive discoveries are durable source information. Their search
        // cooldown expiring is no reason to lose a usable site or spend again.
        if (preparedUrls.length) {
          website = {
            ...cached,
            urls: preparedUrls,
            status: "found",
          };
        } else if (searchFresh) {
          website = {
            ...cached,
            urls: officialWebsites(cached.urls, safeOfficialPhotoUrl),
          };
        } else if (
          reservation &&
          Date.parse(reservation.reservedAt) + SEARCH_CACHE_MS > current
        ) {
          website = {
            urls: [],
            status: "unavailable",
            source: "tavily",
            searchedAt: reservation.reservedAt,
            searchExpiresAt: new Date(
              Date.parse(reservation.reservedAt) + SEARCH_CACHE_MS,
            ).toISOString(),
          };
        } else {
          const month = checkedAt.slice(0, 7);
          const attempts = ledger.months[month]?.attempts ?? [];
          if (
            options.searchEnabled &&
            report.searches < maxSearches &&
            attempts.length < monthlyCap
          ) {
            const attempt = {
              id: randomUUID(),
              venueKey,
              reservedAt: checkedAt,
              status: "reserved",
            };
            ledger.months[month] ??= { attempts };
            attempts.push(attempt);
            reservations.set(venueKey, attempt);
            await atomicJson(ledgerPath, ledger);
            report.searches++;
            let result;
            try {
              result = await boundedProvider(
                (budget) => searchOfficialWebsite(query, budget),
                3000,
              );
            } catch {
              result = { urls: [], status: "unavailable" };
            }
            const urls = officialWebsites(result?.urls, safeOfficialPhotoUrl);
            const status = SEARCH_STATUSES.has(result?.status)
              ? result.status
              : "unavailable";
            website = {
              urls: status === "found" ? urls : [],
              status: status === "found" && !urls.length ? "no-match" : status,
              source: "tavily",
              searchedAt: checkedAt,
              searchExpiresAt: new Date(
                current + SEARCH_CACHE_MS,
              ).toISOString(),
            };
            attempt.status = website.status;
            attempt.completedAt = new Date(now()).toISOString();
            await atomicJson(ledgerPath, ledger);
            discovered.set(venueKey, website);
            // Retain discovery even if the process stops during the following HTML read.
            const pendingEvidence = {
              attempts: [],
              reason: "website-preview-pending",
            };
            entries.set(
              key,
              priorImage
                ? {
                    ...prior,
                    reviewVersion,
                    website,
                    image: photoMetadata(priorImage),
                    refreshFailure: {
                      at: checkedAt,
                      reviewVersion,
                      evidence: pendingEvidence,
                    },
                  }
                : {
                    query,
                    checkedAt,
                    reviewVersion,
                    website,
                    image: null,
                    retryable: true,
                    status: "retryable",
                    evidence: pendingEvidence,
                  },
            );
            await checkpoint();
          } else {
            searchSkipped = true;
          }
        }
      }
      const attempts = [];
      let image = null;
      let retryable = website.status === "unavailable";
      let previewIncomplete = false;
      for (const url of website.urls) {
        if (!remainingMs() || report.timeBudgetExhausted) {
          report.timeBudgetExhausted = true;
          retryable = true;
          previewIncomplete = true;
          break;
        }
        let result;
        try {
          result = await boundedProvider(
            (budget) =>
              resolveOfficialWebsitePreview(
                { ...query, website: url },
                { ...budget, refresh: Boolean(options.refresh) },
              ),
            timeoutMs,
          );
        } catch {
          previewIncomplete ||= report.timeBudgetExhausted;
          result = {
            image: null,
            retryable: true,
            result: { reason: "website-unavailable" },
          };
        }
        attempts.push(previewEvidence(url, result, safeOfficialPhotoUrl));
        retryable ||= Boolean(result?.retryable);
        image = photoMetadata(approvedPhoto(result?.image, checkedAt));
        if (image) break;
      }
      if (!remainingMs()) report.timeBudgetExhausted = true;
      const evidence = {
        attempts,
        reason:
          previewIncomplete && !image
            ? "website-preview-pending"
            : searchSkipped
              ? "search-budget-or-key-disabled"
              : website.urls.length
                ? null
                : `website-${website.status}`,
      };
      let entry;
      // HTML parser absence (including a non-retryable no-match) cannot prove
      // that a previously verified photograph was removed or became invalid.
      if (!image && priorImage) {
        entry = {
          ...prior,
          reviewVersion,
          website,
          image: photoMetadata(priorImage),
          retryable: false,
          refreshFailure: { at: checkedAt, reviewVersion, evidence },
        };
      } else {
        entry = {
          query,
          checkedAt,
          reviewVersion,
          website,
          image,
          retryable: image ? false : retryable,
          status: image
            ? "matched"
            : retryable
              ? "retryable"
              : searchSkipped
                ? "search-skipped"
                : "unresolved",
          evidence,
        };
      }
      entries.set(key, entry);
      discovered.set(venueKey, website);
      await checkpoint();
      report.processed++;
      if (entry.image) report.matched++;
      else if (entry.retryable) report.retryable++;
      else if (entry.status === "search-skipped") report.searchSkipped++;
      else report.unresolved++;
      await onOutcome({
        id: query.id,
        name: query.name,
        status: entry.status,
        searchStatus: website.status,
        searches: report.searches,
      });
      if (!remainingMs()) report.timeBudgetExhausted = true;
    }
    if (!report.processed) await checkpoint();
    return report;
  });
}
