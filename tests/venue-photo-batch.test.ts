import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runVenuePhotoBatch } from "../scripts/lib/venue-photo-batch.mjs";
import { placePhotoQuery, photoVenueIdentity } from "@/providers/photo-query";
import { approvedPhoto } from "@/providers/photo-policy";
import { safeOfficialPhotoUrl } from "@/providers/official-photo";

const folders: string[] = [];
const start = Date.parse("2026-10-28T12:00:00Z");
const day = 86400000;
const place = (id: string, website?: string) => ({
  id,
  name: `Acorn Play ${id}`,
  coordinates: { lat: 51.3, lng: -0.8 },
  area: "Fleet",
  website,
});
const identity = (query: ReturnType<typeof placePhotoQuery>) =>
  JSON.stringify([
    query.id || null,
    query.name.toLowerCase(),
    query.lat.toFixed(4),
    query.lng.toFixed(4),
  ]);
const photo = (name: string) => ({
  url: "https://acornplay.co.uk/interior.jpg",
  source: "https://acornplay.co.uk/",
  credit: name,
  license: "Website preview — rights reserved",
  rights: "website-preview",
  strategy: "official-website-preview",
  checkedAt: new Date(start).toISOString(),
  preview: {
    pageUrl: "https://acornplay.co.uk/",
    publisher: name,
    kind: "venue-image",
    identityEvidence: ["venue name and local address"],
    subjectEvidence: ["physical venue scene in image metadata"],
  },
});
const empty = (retryable = false) => ({
  image: null,
  retryable,
  result: {
    pageUrl: "https://acornplay.co.uk/",
    reason: retryable ? "website-network" : "no-venue-photo",
    requestCount: 1,
    retryable,
    candidates: [],
    rejected: {},
    identity: { branchSpecific: true, evidence: ["venue name"] },
  },
});
async function setup() {
  const folder = await mkdtemp(join(tmpdir(), "venue-photo-batch-"));
  folders.push(folder);
  return {
    output: join(folder, "previews.json"),
    ledger: join(folder, "ledger.json"),
  };
}
function providers(overrides = {}) {
  return {
    placePhotoQuery,
    photoVenueIdentity,
    websiteDiscoveryIdentity: identity,
    safeOfficialPhotoUrl,
    approvedPhoto,
    searchOfficialWebsite: vi.fn(async () => ({
      urls: [],
      status: "no-match",
    })),
    resolveOfficialWebsitePreview: vi.fn<
      (
        query: ReturnType<typeof placePhotoQuery>,
        options: { timeoutMs: number },
      ) => Promise<ReturnType<typeof empty>>
    >(async () => empty()),
    now: () => start,
    ...overrides,
  };
}
const json = async (file: string) => JSON.parse(await readFile(file, "utf8"));
afterEach(async () => {
  await Promise.all(
    folders
      .splice(0)
      .map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

it("uses zero searches by default, including with a key, and reads mapped sites directly", async () => {
  const paths = await setup();
  const deps = providers({
    resolveOfficialWebsitePreview: vi.fn(async (query) => ({
      ...empty(),
      image: photo(query.name),
    })),
  });
  const report = await runVenuePhotoBatch(
    {
      ...paths,
      searchEnabled: true,
      places: [
        place("mapped", "http://acornplay.co.uk/"),
        place("missing"),
        place("unsafe", "https://127.0.0.1/"),
      ],
    },
    deps,
  );
  expect(deps.searchOfficialWebsite).not.toHaveBeenCalled();
  expect(deps.resolveOfficialWebsitePreview).toHaveBeenCalledTimes(1);
  expect(deps.resolveOfficialWebsitePreview.mock.calls[0][0].website).toBe(
    "https://acornplay.co.uk/",
  );
  expect(deps.resolveOfficialWebsitePreview.mock.calls[0][1].timeoutMs).toBe(
    12000,
  );
  expect(report.searches).toBe(0);
  const manifest = await json(paths.output);
  expect(manifest.entries).toHaveLength(3);
  expect(manifest.entries[0].website.source).toBe("mapped");
  expect(manifest.entries[0].status).toBe("matched");
  expect(manifest.entries[1].status).toBe("search-skipped");
});

it("reserves every attempt durably before search and caches failures for at least 30 days", async () => {
  const paths = await setup();
  const search = vi.fn(async () => {
    const ledger = await json(paths.ledger);
    expect(ledger.months["2026-10"].attempts[0].status).toBe("reserved");
    throw new Error("private provider error");
  });
  const options = {
    ...paths,
    places: [place("missing")],
    searchEnabled: true,
    maxSearches: 1,
  };
  await runVenuePhotoBatch(
    options,
    providers({ searchOfficialWebsite: search }),
  );
  expect(search).toHaveBeenCalledTimes(1);
  expect((await json(paths.ledger)).months["2026-10"].attempts[0].status).toBe(
    "unavailable",
  );
  const cached = providers({ now: () => start + 29 * day });
  await runVenuePhotoBatch({ ...options, refresh: true }, cached);
  expect(cached.searchOfficialWebsite).not.toHaveBeenCalled();
  expect((await json(paths.output)).entries[0].website.status).toBe(
    "unavailable",
  );
  const expired = providers({ now: () => start + 31 * day });
  await runVenuePhotoBatch({ ...options, refresh: true }, expired);
  expect(expired.searchOfficialWebsite).toHaveBeenCalledTimes(1);
  expect(await readFile(paths.output, "utf8")).not.toContain(
    "private provider error",
  );
});

it("reuses positive discovery after restart and suppresses crash-reserved searches", async () => {
  const paths = await setup();
  const p = place("positive");
  const first = providers({
    searchOfficialWebsite: vi.fn(async () => ({
      urls: ["https://acornplay.co.uk/"],
      status: "found",
    })),
  });
  const options = {
    ...paths,
    places: [p],
    maxSearches: 1,
    searchEnabled: true,
  };
  await runVenuePhotoBatch(options, first);
  const second = providers({ now: () => start + day });
  const saved = await json(paths.output);
  // A previously prepared file without an explicit expiry still gets 30 days.
  delete saved.entries[0].website.searchExpiresAt;
  await writeFile(paths.output, JSON.stringify(saved));
  await runVenuePhotoBatch({ ...options, refresh: true }, second);
  expect(second.searchOfficialWebsite).not.toHaveBeenCalled();
  expect(second.resolveOfficialWebsitePreview.mock.calls[0][0].website).toBe(
    "https://acornplay.co.uk/",
  );
  const crash = place("crashed");
  const ledger = await json(paths.ledger);
  ledger.months["2026-10"].attempts.push({
    id: "interrupted",
    venueKey: identity(placePhotoQuery(crash as never)),
    reservedAt: new Date(start).toISOString(),
    status: "reserved",
  });
  await writeFile(paths.ledger, JSON.stringify(ledger));
  await runVenuePhotoBatch(
    { ...options, places: [crash], refresh: true },
    second,
  );
  expect(second.searchOfficialWebsite).not.toHaveBeenCalled();
  expect((await json(paths.output)).entries.at(-1).website.status).toBe(
    "unavailable",
  );
});

it("keeps negative discovery cached after a backwards clock change", async () => {
  const paths = await setup();
  const options = {
    ...paths,
    places: [place("clock")],
    maxSearches: 1,
    searchEnabled: true,
  };
  await runVenuePhotoBatch(options, providers());
  const earlier = providers({ now: () => start - day });
  await runVenuePhotoBatch({ ...options, refresh: true }, earlier);
  expect(earlier.searchOfficialWebsite).not.toHaveBeenCalled();
});

it("uses newly mapped source information despite a cached absence", async () => {
  const paths = await setup();
  const options = { ...paths, maxSearches: 1, searchEnabled: true };
  await runVenuePhotoBatch(
    { ...options, places: [place("new-source")] },
    providers(),
  );
  const mapped = providers();
  await runVenuePhotoBatch(
    { ...options, places: [place("new-source", "https://acornplay.co.uk/")] },
    mapped,
  );
  expect(mapped.resolveOfficialWebsitePreview).toHaveBeenCalledTimes(1);
  expect(mapped.searchOfficialWebsite).not.toHaveBeenCalled();
});

it("treats an OSM provenance fallback as a missing official website", async () => {
  const paths = await setup();
  const deps = providers({
    searchOfficialWebsite: vi.fn(async () => ({
      urls: ["https://acornplay.co.uk/"],
      status: "found",
    })),
  });
  await runVenuePhotoBatch(
    {
      ...paths,
      places: [place("osm", "https://www.openstreetmap.org/node/123")],
      searchEnabled: true,
      maxSearches: 1,
    },
    deps,
  );
  expect(deps.searchOfficialWebsite).toHaveBeenCalledTimes(1);
  expect(deps.resolveOfficialWebsitePreview.mock.calls[0][0].website).toBe(
    "https://acornplay.co.uk/",
  );
});

it("honours the monthly ledger across runs and resets the cap only in a new UTC month", async () => {
  const paths = await setup();
  const options = {
    ...paths,
    maxSearches: 2,
    monthlyCap: 1,
    searchEnabled: true,
  };
  const deps = providers();
  await runVenuePhotoBatch(
    { ...options, places: [place("one"), place("two")] },
    deps,
  );
  expect(deps.searchOfficialWebsite).toHaveBeenCalledTimes(1);
  await runVenuePhotoBatch({ ...options, places: [place("three")] }, deps);
  expect(deps.searchOfficialWebsite).toHaveBeenCalledTimes(1);
  const november = providers({ now: () => Date.parse("2026-11-01T00:00:00Z") });
  await runVenuePhotoBatch({ ...options, places: [place("four")] }, november);
  expect(november.searchOfficialWebsite).toHaveBeenCalledTimes(1);
  expect(Object.keys((await json(paths.ledger)).months)).toEqual([
    "2026-10",
    "2026-11",
  ]);
  await expect(
    runVenuePhotoBatch({ ...options, monthlyCap: 1001, places: [] }, deps),
  ).rejects.toThrow("monthlyCap");
});

it("does not search without a key even with an explicit search budget", async () => {
  const paths = await setup();
  const deps = providers();
  await runVenuePhotoBatch(
    {
      ...paths,
      places: [place("missing")],
      maxSearches: 10,
      searchEnabled: false,
    },
    deps,
  );
  expect(deps.searchOfficialWebsite).not.toHaveBeenCalled();
});

it("limits the batch, checkpoints every outcome and resumes the remaining venues", async () => {
  const paths = await setup();
  let calls = 0;
  const preview = vi.fn(async () => {
    if (calls++ === 1)
      expect((await json(paths.output)).entries).toHaveLength(1);
    return empty();
  });
  const deps = providers({ resolveOfficialWebsitePreview: preview });
  const places = ["one", "two", "three"].map((id) =>
    place(id, "https://acornplay.co.uk/"),
  );
  const first = await runVenuePhotoBatch({ ...paths, places, limit: 2 }, deps);
  expect(first.processed).toBe(2);
  expect(preview).toHaveBeenCalledTimes(2);
  const next = await runVenuePhotoBatch({ ...paths, places, limit: 1 }, deps);
  expect(next.processed).toBe(1);
  expect((await json(paths.output)).entries).toHaveLength(3);
});

it("preserves a previously approved photo and its verification time after a transient refresh failure", async () => {
  const paths = await setup();
  const p = place("verified", "https://acornplay.co.uk/");
  const reviewed = photo(p.name);
  const review = {
    method: "visual-review",
    imageUrl: reviewed.url,
    checkedAt: new Date(start).toISOString(),
    description: "A soft play frame and venue seating occupy the interior.",
    sha256: "a".repeat(64),
  };
  Object.assign(reviewed.preview, { review });
  await runVenuePhotoBatch(
    { ...paths, places: [p] },
    providers({
      resolveOfficialWebsitePreview: vi.fn(async () => ({
        ...empty(),
        image: reviewed,
      })),
    }),
  );
  const before = (await json(paths.output)).entries[0];
  await runVenuePhotoBatch(
    { ...paths, places: [p], refresh: true },
    providers({
      now: () => start + day,
      resolveOfficialWebsitePreview: vi.fn(async () => empty(true)),
    }),
  );
  const after = (await json(paths.output)).entries[0];
  expect(after.image).toEqual(before.image);
  expect(after.image.preview.review).toEqual(review);
  expect(after.checkedAt).toBe(before.checkedAt);
  expect(after.retryable).toBe(false);
  expect(after.refreshFailure.at).toBe(new Date(start + day).toISOString());
  expect(after.refreshFailure.evidence.attempts[0].reason).toBe(
    "website-network",
  );
});

it("runs the CLI with normalized input and a configured key without any default search requests", async () => {
  const paths = await setup();
  const input = join(paths.output, "..", "input.json");
  const preload = join(paths.output, "..", "reject-network.mjs");
  const network = join(paths.output, "..", "unexpected-network.txt");
  await writeFile(input, JSON.stringify([place("cli-one"), place("cli-two")]));
  await writeFile(
    preload,
    `import { writeFile } from 'node:fs/promises';
globalThis.fetch = async () => {
  await writeFile(${JSON.stringify(network)}, 'called');
  throw new Error('Unexpected network request');
};\n`,
  );
  await promisify(execFile)(
    process.execPath,
    [
      "--import",
      preload,
      "scripts/prepare-venue-photos.mjs",
      `--input=${input}`,
      `--output=${paths.output}`,
      `--ledger=${paths.ledger}`,
      "--limit=1",
    ],
    { env: { ...process.env, TAVILY_API_KEY: "test-key-no-spend" } },
  );
  expect((await json(paths.output)).entries).toHaveLength(1);
  await expect(readFile(network, "utf8")).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("keeps unknown subjects unapproved and persists only the metadata allowlist", async () => {
  const paths = await setup();
  const deps = providers({
    resolveOfficialWebsitePreview: vi.fn(async () => ({
      ...empty(),
      image: {
        ...photo("unknown"),
        rights: "unverified",
        buffer: Buffer.from("image bytes"),
      },
      html: "<html>private raw source</html>",
      result: {
        ...empty().result,
        candidates: [
          {
            url: "https://acornplay.co.uk/unknown.jpg",
            photoScore: 0,
            subjectEvidence: [],
            buffer: Buffer.from("image bytes"),
          },
        ],
        html: "<html>private raw source</html>",
      },
    })),
  });
  await runVenuePhotoBatch(
    { ...paths, places: [place("unknown", "https://acornplay.co.uk/")] },
    deps,
  );
  const data = await json(paths.output);
  expect(data.entries[0].image).toBeNull();
  expect(data.entries[0].status).toBe("unresolved");
  expect(data.entries[0].evidence.attempts[0].candidates[0].url).toContain(
    "unknown.jpg",
  );
  expect(await readFile(paths.output, "utf8")).not.toMatch(
    /private raw source|image bytes|"buffer"/,
  );
});

it("holds an exclusive local lock and releases it after the batch", async () => {
  const paths = await setup();
  let release!: () => void;
  let entered!: () => void;
  const enteredPreview = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const deps = providers({
    resolveOfficialWebsitePreview: vi.fn(async () => {
      entered();
      await wait;
      return empty();
    }),
  });
  const options = {
    ...paths,
    places: [place("locked", "https://acornplay.co.uk/")],
  };
  const running = runVenuePhotoBatch(options, deps);
  await enteredPreview;
  try {
    await expect(runVenuePhotoBatch(options, providers())).rejects.toThrow(
      /lock/i,
    );
  } finally {
    release();
    await running;
  }
  await expect(readFile(`${paths.ledger}.lock`, "utf8")).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("prioritizes mapped sites over missing sites and progresses past cached skipped work", async () => {
  const paths = await setup();
  const places = [
    place("missing-one"),
    place("missing-two"),
    place("mapped-last", "https://acornplay.co.uk/"),
  ];
  const options = { ...paths, places, limit: 1 };
  await runVenuePhotoBatch(options, providers());
  expect(
    (await json(paths.output)).entries.map(
      (entry: { query: { id: string } }) => entry.query.id,
    ),
  ).toEqual(["mapped-last"]);
  await runVenuePhotoBatch(options, providers());
  await runVenuePhotoBatch(options, providers());
  expect(
    (await json(paths.output)).entries.map(
      (entry: { query: { id: string } }) => entry.query.id,
    ),
  ).toEqual(["mapped-last", "missing-one", "missing-two"]);
});

it("advances forced maintenance to unattempted sites before repeating failures", async () => {
  const paths = await setup();
  const options = {
    ...paths,
    places: ["one", "two"].map((id) => place(id, "https://acornplay.co.uk/")),
    limit: 1,
    refresh: true,
  };
  const deps = providers({
    resolveOfficialWebsitePreview: async () => empty(true),
  });
  await runVenuePhotoBatch(options, deps);
  await runVenuePhotoBatch(options, deps);
  expect(
    (await json(paths.output)).entries.map(
      (entry: { query: { id: string } }) => entry.query.id,
    ),
  ).toEqual(["one", "two"]);
});

it("backs off transient site failures during normal maintenance", async () => {
  const paths = await setup();
  const options = {
    ...paths,
    places: [place("retry", "https://acornplay.co.uk/")],
  };
  const deps = providers({
    resolveOfficialWebsitePreview: async () => empty(true),
  });
  await runVenuePhotoBatch(options, deps);
  const next = await runVenuePhotoBatch(
    options,
    providers({ now: () => start + 60000 }),
  );
  expect(next.processed).toBe(0);
  expect(next.cached).toBe(1);
  const due = await runVenuePhotoBatch(
    options,
    providers({ now: () => start + day }),
  );
  expect(due.processed).toBe(1);
});

it("preserves a reviewed positive when refreshed HTML simply has no matching photo", async () => {
  const paths = await setup();
  const p = place("reviewed", "https://acornplay.co.uk/");
  const reviewed = photo(p.name);
  Object.assign(reviewed.preview, {
    review: {
      method: "visual-review",
      imageUrl: reviewed.url,
      checkedAt: new Date(start).toISOString(),
      description: "A soft play frame and venue seating occupy the interior.",
    },
  });
  await runVenuePhotoBatch(
    { ...paths, places: [p] },
    providers({
      resolveOfficialWebsitePreview: async () => ({
        ...empty(),
        image: reviewed,
      }),
    }),
  );
  const before = (await json(paths.output)).entries[0];
  await runVenuePhotoBatch(
    { ...paths, places: [p], refresh: true },
    providers({ now: () => start + day }),
  );
  const after = (await json(paths.output)).entries[0];
  expect(after.image).toEqual(before.image);
  expect(after.checkedAt).toBe(before.checkedAt);
  expect(after.refreshFailure.evidence.attempts[0].reason).toBe(
    "no-venue-photo",
  );
});

it("keeps previously discovered official sites usable without another paid search", async () => {
  const paths = await setup();
  const options = {
    ...paths,
    places: [place("discovered")],
    searchEnabled: true,
    maxSearches: 1,
  };
  await runVenuePhotoBatch(
    options,
    providers({
      searchOfficialWebsite: async () => ({
        status: "found",
        urls: ["https://acornplay.co.uk/"],
      }),
    }),
  );
  await runVenuePhotoBatch(
    { ...options, maxSearches: 0 },
    providers({ now: () => start + 31 * day }),
  );
  const after = (await json(paths.output)).entries[0];
  expect(after.website.urls).toEqual(["https://acornplay.co.uk/"]);
  expect(after.evidence.attempts).toHaveLength(1);
  expect((await json(paths.ledger)).months["2026-10"].attempts).toHaveLength(1);
});

it("opens previously skipped discovery when an explicit search budget becomes available", async () => {
  const paths = await setup();
  const options = { ...paths, places: [place("new-budget")] };
  await runVenuePhotoBatch(options, providers());
  await runVenuePhotoBatch(
    { ...options, searchEnabled: true, maxSearches: 1 },
    providers(),
  );
  expect((await json(paths.ledger)).months["2026-10"].attempts).toHaveLength(1);
  expect((await json(paths.output)).entries[0].website.status).toBe("no-match");
});

it("uses the batch for uncovered places while preserving invalid supplied photos as unresolved", async () => {
  const paths = await setup();
  await runVenuePhotoBatch(
    {
      ...paths,
      limit: 1,
      places: [
        {
          ...place("covered", "https://acornplay.co.uk/"),
          image: photo("covered"),
        },
        {
          ...place("uncovered", "https://acornplay.co.uk/"),
          image: { ...photo("uncovered"), rights: "unverified" },
        },
      ],
    },
    providers(),
  );
  expect((await json(paths.output)).entries[0].query.id).toBe("uncovered");
});

it("retains one durable positive when aliases or source metadata enrich an existing venue", async () => {
  const paths = await setup();
  const p = place("enriched", "https://acornplay.co.uk/");
  await runVenuePhotoBatch(
    { ...paths, places: [p] },
    providers({
      resolveOfficialWebsitePreview: async () => ({
        ...empty(),
        image: photo(p.name),
      }),
    }),
  );
  await runVenuePhotoBatch(
    {
      ...paths,
      places: [{ ...p, aliases: ["Acorn Play Fleet"] }],
      refresh: true,
    },
    providers(),
  );
  const entries = (await json(paths.output)).entries;
  expect(entries).toHaveLength(1);
  expect(entries[0].image.url).toBe("https://acornplay.co.uk/interior.jpg");
});

it("resumes a pending preview checkpoint without waiting for the retry cooldown", async () => {
  const paths = await setup();
  const options = {
    ...paths,
    places: [place("pending")],
    searchEnabled: true,
    maxSearches: 1,
  };
  let pending;
  await runVenuePhotoBatch(
    options,
    providers({
      searchOfficialWebsite: async () => ({
        status: "found",
        urls: ["https://acornplay.co.uk/"],
      }),
      resolveOfficialWebsitePreview: async () => {
        pending = await json(paths.output);
        return empty(true);
      },
    }),
  );
  await writeFile(paths.output, JSON.stringify(pending));
  const report = await runVenuePhotoBatch(
    options,
    providers({
      resolveOfficialWebsitePreview: async (
        query: ReturnType<typeof placePhotoQuery>,
      ) => ({
        ...empty(),
        image: photo(query.name),
      }),
    }),
  );
  expect(report.processed).toBe(1);
  expect((await json(paths.output)).entries[0].status).toBe("matched");
  expect((await json(paths.ledger)).months["2026-10"].attempts).toHaveLength(1);
});

it.each([
  "{",
  JSON.stringify({ version: 1, months: { "2026-10": { attempts: [{}] } } }),
])(
  "refuses corrupt ledgers without resetting reservations: %s",
  async (contents) => {
    const paths = await setup();
    await writeFile(paths.ledger, contents);
    await expect(
      runVenuePhotoBatch(
        {
          ...paths,
          places: [place("missing")],
          searchEnabled: true,
          maxSearches: 1,
        },
        providers(),
      ),
    ).rejects.toThrow();
    expect(await readFile(paths.ledger, "utf8")).toBe(contents);
    await expect(readFile(paths.output, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);
