import { afterEach, expect, test, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  readGeographCandidates,
  runGeographPhotoBatch,
} from "../scripts/lib/geograph-photo-batch.mjs";
import {
  approvedPhoto,
  LOCAL_PHOTO_REVIEW_MODEL,
  LOCAL_PHOTO_REVIEW_GROUPS,
  LOCAL_PHOTO_REVIEW_THRESHOLD,
} from "@/providers/photo-policy";
import { websiteDiscoveryIdentity } from "@/providers/prepared-venue-photos";

const now = Date.parse("2026-10-29T12:00:00Z");
const query = {
  id: "osm-node-123",
  name: "Cedarwood Country Park",
  lat: 51.3,
  lng: -0.8,
};
const candidate = {
  status: "candidate",
  geographId: 12345,
  title: "Cedarwood Country Park",
  photographer: "Jane Smith",
  photographerId: 12,
  photoTaken: "2025-06-12",
  coordinates: { lat: 51.3, lng: -0.8 },
  pageUrl: "https://www.geograph.org.uk/photo/12345",
  license: "CC BY-SA 2.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/2.0/",
  subjectPrecision: { digits: 8, metres: 10 },
  evidence: {
    normalizedVenueName: "cedarwood country park",
    nameMatch: "full-normalized-phrase",
    distanceMetres: 0,
    coordinateRole: "subject",
    uniqueNearbyVenue: true,
  },
};
const input = (candidates = [candidate]) => ({
  version: 1,
  status: "candidates",
  license: "CC BY-SA 2.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/2.0/",
  sources: ["gridimage_base", "gridimage_geo"].map((table) => ({
    url: `https://data.geograph.org.uk/dumps/${table}.tsv.gz`,
    sha256: "a".repeat(64),
    compressedBytes: 100,
  })),
  criteria: {
    maximumDistanceMetres: 150,
    minimumSubjectGridDigits: 8,
    maximumPerVenue: 3,
    requireUnrestrictedSubjectPosition: true,
  },
  entries: [{ query, identity: websiteDiscoveryIdentity(query), candidates }],
});
const image = {
  url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Cedarwood.jpg",
  source: "https://commons.wikimedia.org/wiki/File:Cedarwood.jpg",
  credit: "Jane Smith",
  license: "CC BY-SA 2.0",
  rights: "open" as const,
  strategy: "geograph-commons-source-id",
  checkedAt: new Date(now).toISOString(),
  width: 960,
  height: 640,
  matched: ["exact-geograph-source-id"],
};
const matched = () => ({
  image,
  reason: "matched",
  retryable: false,
  requestCount: 2,
  evidence: {
    geographId: "12345",
    candidateCount: 1,
    lookup: "structured-id",
    commonsPageId: 99,
    commonsTitle: "File:Cedarwood.jpg",
    sourceUrl: candidate.pageUrl,
    structuredIds: ["12345"],
    description: candidate.title,
    photographer: "Jane Smith",
    warnings: [],
  },
});
const missing = () => ({
  image: null,
  reason: "not-found",
  retryable: false,
  requestCount: 2,
  evidence: { geographId: "12345", candidateCount: 0, warnings: [] },
});
const sceneReview = () => ({
  accepted: true,
  sha256: "b".repeat(64),
  width: 960,
  height: 640,
  localClip: {
    model: LOCAL_PHOTO_REVIEW_MODEL,
    ...LOCAL_PHOTO_REVIEW_THRESHOLD,
    bestVenueScore: 0.9,
    bestRejectScore: 0.0125,
    margin: 0.9 - 0.0125,
    scores: Object.entries(LOCAL_PHOTO_REVIEW_GROUPS).map(([id, group]) => ({
      id,
      group,
      score: id === "outdoor-place" ? 0.9 : 0.0125,
    })),
  },
  diagnostics: { status: "accepted", modelStatus: "ready" },
});
const folders: string[] = [];
async function setup() {
  const folder = await mkdtemp(join(tmpdir(), "geograph-photo-batch-"));
  folders.push(folder);
  return { output: join(folder, "previews.json") };
}
const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));
function providers(overrides = {}) {
  return {
    approvedPhoto,
    websiteDiscoveryIdentity,
    now: () => now,
    pause: vi.fn(async () => {}),
    resolveGeographCommonsPhoto: vi.fn(async () => matched()),
    reviewPhotograph: vi.fn(async () => sceneReview()),
    ...overrides,
  };
}
afterEach(async () => {
  await Promise.all(
    folders
      .splice(0)
      .map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

test("reads bounded compressed candidate metadata, never image bytes", async () => {
  const paths = await setup();
  const file = join(paths.output, "..", "matches.json.gz");
  await writeFile(file, gzipSync(JSON.stringify(input())));
  expect(await readGeographCandidates(file)).toEqual(input());
  await writeFile(file, gzipSync("[]"));
  await expect(readGeographCandidates(file)).rejects.toThrow(/candidate/i);
});

test("prepares an exact source-linked open photograph and checkpoints only URL evidence", async () => {
  const paths = await setup();
  const deps = providers();
  const report = await runGeographPhotoBatch(
    { ...paths, candidates: input() },
    deps,
  );
  expect(report).toMatchObject({
    processed: 1,
    matched: 1,
    requests: 2,
    unresolved: 0,
  });
  expect(deps.resolveGeographCommonsPhoto).toHaveBeenCalledWith(
    12345,
    expect.objectContaining({
      expectedTitle: candidate.title,
      expectedPhotographer: candidate.photographer,
      signal: expect.any(AbortSignal),
    }),
  );
  const [entry] = (await json(paths.output)).entries;
  expect(entry.image).toMatchObject({
    ...image,
    matched: expect.arrayContaining([
      "exact-geograph-source-id",
      "full venue name in Geograph subject title",
      "precise Geograph subject position within 150m",
    ]),
  });
  expect(entry.geograph).toMatchObject({
    geographId: 12345,
    photoTaken: "2025-06-12",
    status: "matched",
  });
  expect(entry.evidence.vision).toMatchObject({
    method: "image-analysis:local-clip",
    imageUrl: image.url,
    sha256: "b".repeat(64),
    localClip: sceneReview().localClip,
  });
  expect(entry.website).toEqual({
    urls: [],
    status: "no-match",
    source: "none",
  });
  expect(JSON.stringify(entry)).not.toMatch(/buffer|base64|<html/i);
});

test("never replaces an existing approved photograph or invokes a provider for it", async () => {
  const paths = await setup();
  const deps = providers();
  const prior = {
    query,
    checkedAt: image.checkedAt,
    image: { ...image, url: `${image.url}?old=1` },
    website: {
      urls: ["https://cedarwood.co.uk"],
      status: "found",
      source: "mapped",
    },
    deliveryVerifiedAt: image.checkedAt,
  };
  await writeFile(
    paths.output,
    JSON.stringify({ version: 1, entries: [prior] }),
  );
  expect(
    await runGeographPhotoBatch({ ...paths, candidates: input() }, deps),
  ).toMatchObject({ processed: 0, existing: 1 });
  expect(deps.resolveGeographCommonsPhoto).not.toHaveBeenCalled();
  expect((await json(paths.output)).entries).toEqual([prior]);
});

test("preserves existing curated seed IDs while adding an OSM candidate", async () => {
  const paths = await setup();
  const seed = {
    query: { ...query, id: "lightwater", name: "Lightwater Country Park" },
    checkedAt: image.checkedAt,
    image,
    status: "matched",
    retryable: false,
    website: { urls: [], status: "no-match", source: "none" },
  };
  await writeFile(
    paths.output,
    JSON.stringify({ version: 1, entries: [seed] }),
  );
  expect(
    await runGeographPhotoBatch({ ...paths, candidates: input() }, providers()),
  ).toMatchObject({ processed: 1, matched: 1 });
  expect((await json(paths.output)).entries[0]).toEqual(seed);
});

test.each(["2025-00-00", "2025-06-00"])(
  "accepts recent documented partial capture date %s while retaining it honestly",
  async (photoTaken) => {
    const paths = await setup();
    expect(
      await runGeographPhotoBatch(
        { ...paths, candidates: input([{ ...candidate, photoTaken }]) },
        providers(),
      ),
    ).toMatchObject({ matched: 1 });
    expect((await json(paths.output)).entries[0].geograph.photoTaken).toBe(
      photoTaken,
    );
  },
);

test("negative cache does not overwrite official-site evidence and source changes retry immediately", async () => {
  const paths = await setup();
  const deps = providers({
    resolveGeographCommonsPhoto: vi.fn(async () => missing()),
  });
  const prior = {
    query: { ...query, website: "https://cedarwood.co.uk" },
    checkedAt: "2026-10-01T00:00:00Z",
    image: null,
    reviewVersion: "local-clip-v2",
    website: {
      urls: ["https://cedarwood.co.uk"],
      status: "found",
      source: "mapped",
    },
    evidence: { reason: "no-venue-photo" },
  };
  await writeFile(
    paths.output,
    JSON.stringify({ version: 1, entries: [prior] }),
  );
  await runGeographPhotoBatch({ ...paths, candidates: input() }, deps);
  expect((await json(paths.output)).entries[0]).toMatchObject(prior);
  expect(
    await runGeographPhotoBatch({ ...paths, candidates: input() }, deps),
  ).toMatchObject({ processed: 0, cached: 1 });
  expect(deps.resolveGeographCommonsPhoto).toHaveBeenCalledTimes(1);
  await runGeographPhotoBatch(
    {
      ...paths,
      candidates: input([{ ...candidate, photoTaken: "2025-06-13" }]),
    },
    deps,
  );
  expect(deps.resolveGeographCommonsPhoto).toHaveBeenCalledTimes(2);
});

test.each([
  { ...candidate, coordinates: { lat: 52, lng: -0.8 } },
  { ...candidate, subjectPrecision: { digits: 6, metres: 100 } },
  { ...candidate, title: "Another Park" },
  {
    ...candidate,
    evidence: { ...candidate.evidence, coordinateRole: "camera" },
  },
  {
    ...candidate,
    evidence: { ...candidate.evidence, uniqueNearbyVenue: false },
  },
  { ...candidate, pageUrl: "https://www.geograph.org.uk/photo/123456" },
])(
  "rejects invalid imported identity/precision evidence before network work %j",
  async (invalid) => {
    const paths = await setup();
    const deps = providers();
    await expect(
      runGeographPhotoBatch({ ...paths, candidates: input([invalid]) }, deps),
    ).rejects.toThrow(/candidate|subject|source|venue|precision/i);
    expect(deps.resolveGeographCommonsPhoto).not.toHaveBeenCalled();
  },
);

test.each(["2015-01-01", "2027-01-01", "2025-02-30"])(
  "ignores historical, future, or impossible capture date %s",
  async (photoTaken) => {
    const paths = await setup();
    const deps = providers();
    const report = await runGeographPhotoBatch(
      { ...paths, candidates: input([{ ...candidate, photoTaken }]) },
      deps,
    );
    expect(report).toMatchObject({ processed: 1, matched: 0, unresolved: 1 });
    expect(deps.resolveGeographCommonsPhoto).not.toHaveBeenCalled();
  },
);

test("tries another candidate after a dated or nonphysical subject rather than publishing it", async () => {
  const paths = await setup();
  const resolver = vi.fn(async (id: number) => {
    expect(id).toBe(12345);
    return matched();
  });
  const first = {
    ...candidate,
    geographId: 12346,
    pageUrl: "https://www.geograph.org.uk/photo/12346",
    title: "Cedarwood Country Park car park",
  };
  const report = await runGeographPhotoBatch(
    { ...paths, candidates: input([first, candidate]) },
    providers({ resolveGeographCommonsPhoto: resolver }),
  );
  expect(report.matched).toBe(1);
  expect(resolver).toHaveBeenCalledTimes(1);
  expect(resolver.mock.calls[0][0]).toBe(12345);
});

test.each([
  { evidence: { ...matched().evidence, geographId: "123456" } },
  { evidence: { ...matched().evidence, structuredIds: ["12345", "12346"] } },
  {
    evidence: {
      ...matched().evidence,
      sourceUrl: "https://www.geograph.org.uk/photo/123456",
    },
  },
  {
    evidence: {
      ...matched().evidence,
      description: "A map of Cedarwood Country Park",
    },
  },
  { image: { ...image, width: 100 } },
  { image: { ...image, license: "All rights reserved" } },
])(
  "quarantines unsuitable or conflicting resolver metadata %j",
  async (extra) => {
    const paths = await setup();
    await runGeographPhotoBatch(
      { ...paths, candidates: input() },
      providers({
        resolveGeographCommonsPhoto: vi.fn(async () => ({
          ...matched(),
          ...extra,
        })),
      }),
    );
    expect((await json(paths.output)).entries[0].image).toBeNull();
  },
);

test("honors rate limiting by checkpointing a retryable result and stopping the batch", async () => {
  const paths = await setup();
  const second = { ...query, id: "osm-node-124", name: "Cedarwood Garden" };
  const data = input();
  data.entries.push({
    query: second,
    identity: websiteDiscoveryIdentity(second),
    candidates: [
      {
        ...candidate,
        title: second.name,
        evidence: {
          ...candidate.evidence,
          normalizedVenueName: "cedarwood garden",
        },
      },
    ],
  });
  const deps = providers({
    resolveGeographCommonsPhoto: vi.fn(async () => ({
      ...missing(),
      reason: "http-429",
      retryable: true,
      retryAfterMs: 300000,
    })),
  });
  expect(
    await runGeographPhotoBatch({ ...paths, candidates: data }, deps),
  ).toMatchObject({ processed: 1, retryable: 1, rateLimited: true });
  expect(deps.resolveGeographCommonsPhoto).toHaveBeenCalledTimes(1);
  expect((await json(paths.output)).entries[0].geograph).toMatchObject({
    retryable: true,
    retryAfter: "2026-10-29T12:05:00.000Z",
  });
});

test("checkpoints timeout results and releases the shared official-workflow manifest lock", async () => {
  const paths = await setup();
  const deps = providers({
    resolveGeographCommonsPhoto: vi.fn(async () => new Promise(() => {})),
  });
  const report = await runGeographPhotoBatch(
    { ...paths, candidates: input(), timeoutMs: 10 },
    deps,
  );
  expect(report).toMatchObject({ processed: 1, retryable: 1 });
  expect((await json(paths.output)).entries[0].geograph.reason).toBe(
    "deadline-exceeded",
  );
  expect(
    await runGeographPhotoBatch({ ...paths, candidates: input() }, providers()),
  ).toMatchObject({ cached: 1 });
});

test("refuses the manifest lock, malformed source provenance, and excessive batch size", async () => {
  const paths = await setup();
  await writeFile(`${paths.output}.lock`, "another job");
  await expect(
    runGeographPhotoBatch({ ...paths, candidates: input() }, providers()),
  ).rejects.toThrow(/lock/i);
  await rm(`${paths.output}.lock`);
  const invalid = input();
  invalid.sources[0].url = "https://untrusted.invalid/matches";
  await expect(
    runGeographPhotoBatch({ ...paths, candidates: invalid }, providers()),
  ).rejects.toThrow(/source/i);
  await expect(
    runGeographPhotoBatch(
      { ...paths, candidates: input(), limit: 1001 },
      providers(),
    ),
  ).rejects.toThrow(/limit/i);
});

test("a callback interruption leaves the completed venue checkpoint available to resume", async () => {
  const paths = await setup();
  await expect(
    runGeographPhotoBatch(
      { ...paths, candidates: input() },
      providers({
        onOutcome: () => {
          throw new Error("interrupted");
        },
      }),
    ),
  ).rejects.toThrow("interrupted");
  expect((await json(paths.output)).entries[0].image).toMatchObject({
    ...image,
    matched: expect.arrayContaining(image.matched),
  });
  expect(
    await runGeographPhotoBatch({ ...paths, candidates: input() }, providers()),
  ).toMatchObject({ existing: 1 });
});

test("does not mistake an ancillary parking note in the description for the photographed subject", async () => {
  const paths = await setup();
  expect(
    await runGeographPhotoBatch(
      { ...paths, candidates: input() },
      providers({
        resolveGeographCommonsPhoto: async () => ({
          ...matched(),
          evidence: {
            ...matched().evidence,
            description:
              "Cedarwood Country Park. Parking is available on the nearby street.",
          },
        }),
      }),
    ),
  ).toMatchObject({ matched: 1 });
});

test("requires scene review and never publishes rejected or incomplete local-model proof", async () => {
  const paths = await setup();
  await expect(
    runGeographPhotoBatch(
      { ...paths, candidates: input() },
      providers({ reviewPhotograph: undefined }),
    ),
  ).rejects.toThrow(/review is required/i);
  const rejected = {
    ...sceneReview(),
    accepted: false,
    diagnostics: { status: "rejected", modelStatus: "ready" },
  };
  expect(
    await runGeographPhotoBatch(
      { ...paths, candidates: input() },
      providers({ reviewPhotograph: async () => rejected }),
    ),
  ).toMatchObject({ matched: 0, unresolved: 1, reviewed: 1 });
  expect((await json(paths.output)).entries[0].image).toBeNull();
  for (const invalid of [
    { ...sceneReview(), sha256: "invalid" },
    {
      ...sceneReview(),
      localClip: { ...sceneReview().localClip, minScore: 0.1 },
    },
    {
      ...sceneReview(),
      localClip: {
        ...sceneReview().localClip,
        scores: sceneReview().localClip.scores.slice(1),
      },
    },
    {
      ...sceneReview(),
      localClip: {
        ...sceneReview().localClip,
        model: { ...LOCAL_PHOTO_REVIEW_MODEL, revision: "wrong" },
      },
    },
  ]) {
    expect(
      await runGeographPhotoBatch(
        { ...paths, candidates: input(), refresh: true },
        providers({ reviewPhotograph: async () => invalid }),
      ),
    ).toMatchObject({ matched: 0, retryable: 1 });
    expect((await json(paths.output)).entries[0].image).toBeNull();
  }
});

test("checkpoints a retryable model outage and preserves prior official-site evidence", async () => {
  const paths = await setup();
  await writeFile(
    paths.output,
    JSON.stringify({
      version: 1,
      entries: [
        {
          query,
          checkedAt: "2026-10-01T00:00:00Z",
          image: null,
          website: { urls: [], source: "none", status: "no-match" },
          evidence: { reason: "official-site-no-image" },
        },
      ],
    }),
  );
  expect(
    await runGeographPhotoBatch(
      { ...paths, candidates: input() },
      providers({
        reviewPhotograph: async () => ({
          accepted: false,
          diagnostics: { status: "unavailable" },
        }),
      }),
    ),
  ).toMatchObject({ retryable: 1, matched: 0 });
  const [entry] = (await json(paths.output)).entries;
  expect(entry.geograph.reason).toBe("photo-review-unavailable");
  expect(entry.evidence).toEqual({ reason: "official-site-no-image" });
});

test("resumes a source whose model review was interrupted by the batch deadline immediately", async () => {
  const paths = await setup();
  let clock = now;
  const report = await runGeographPhotoBatch(
    { ...paths, candidates: input(), maxRuntimeMs: 1000 },
    providers({
      now: () => clock,
      resolveGeographCommonsPhoto: async () => {
        clock += 1000;
        return matched();
      },
    }),
  );
  expect(report).toMatchObject({
    processed: 1,
    matched: 0,
    retryable: 1,
    timeBudgetExhausted: true,
  });
  expect((await json(paths.output)).entries[0].geograph.reason).toBe(
    "batch-deadline",
  );
  expect(
    await runGeographPhotoBatch(
      { ...paths, candidates: input() },
      providers({ now: () => clock }),
    ),
  ).toMatchObject({ processed: 1, matched: 1, cached: 0 });
});

test("rechecks a delivery-quarantined photo after a day rather than treating source success as a month-long miss", async () => {
  const paths = await setup();
  await runGeographPhotoBatch({ ...paths, candidates: input() }, providers());
  const prior = await json(paths.output);
  Object.assign(prior.entries[0], {
    image: null,
    retryable: true,
    status: "delivery-unavailable",
    deliveryFailure: {
      checkedAt: image.checkedAt,
      reason: "publisher-image-delivery-failed",
    },
  });
  await writeFile(paths.output, JSON.stringify(prior));
  expect(
    await runGeographPhotoBatch({ ...paths, candidates: input() }, providers()),
  ).toMatchObject({ cached: 1 });
  expect(
    await runGeographPhotoBatch(
      { ...paths, candidates: input() },
      providers({ now: () => now + 2 * 86400000 }),
    ),
  ).toMatchObject({ matched: 1, cached: 0 });
});
