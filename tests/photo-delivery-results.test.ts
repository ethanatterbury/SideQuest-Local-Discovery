import { afterEach, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reconcilePhotoDelivery } from "../scripts/lib/photo-delivery-results.mjs";

const folders: string[] = [];
afterEach(() =>
  folders
    .splice(0)
    .forEach((folder) => rmSync(folder, { recursive: true, force: true })),
);

const image = {
  url: "https://pirateslanding.co.uk/interior.jpg",
  source: "https://pirateslanding.co.uk/",
  credit: "Pirates Landing",
  license: "Website preview — rights reserved",
  rights: "website-preview",
  strategy: "official-website-preview",
  checkedAt: "2026-10-28T00:00:00.000Z",
  preview: {
    pageUrl: "https://pirateslanding.co.uk/",
    publisher: "Pirates Landing",
    kind: "venue-image",
    identityEvidence: ["venue name and location matched"],
    subjectEvidence: ["physical venue scene in image metadata"],
  },
};
const entry = {
  query: { id: "osm-node-123", name: "Pirates Landing", lat: 51.3, lng: -0.8 },
  checkedAt: image.checkedAt,
  image,
  retryable: false,
  status: "matched",
  evidence: { attempts: [{ website: image.source }] },
};
const manifest = (entries: unknown[]) => ({
  version: 1,
  generatedAt: image.checkedAt,
  entries,
});

function report(
  status = "passed",
  options: {
    delivery?: boolean;
    decodedWidth?: number;
    screenshot?: boolean;
    navigationStatus?: number;
  } = {},
) {
  const folder = mkdtempSync(join(tmpdir(), "photo-delivery-results-"));
  folders.push(folder);
  const deliveryPath = join(folder, "delivery.json");
  const screenshotPath = join(folder, "detail.png");
  writeFileSync(
    deliveryPath,
    JSON.stringify({
      id: entry.query.id,
      expectedImageUrl: image.url,
      source: image.source,
      navigationStatus: options.navigationStatus ?? 200,
      venueVisible: true,
      imageDecodedMs: status === "passed" ? 400 : undefined,
      elapsedMs: 500,
      imageFailures:
        status === "passed"
          ? []
          : [{ url: image.url, error: "net::ERR_FAILED" }],
      browser: {
        pageUrl: `http://localhost:3000/place/${entry.query.id}`,
        hero:
          status === "passed"
            ? [
                {
                  src: image.url,
                  currentSrc: image.url,
                  complete: true,
                  naturalWidth: options.decodedWidth ?? 1280,
                  naturalHeight: 800,
                },
              ]
            : [],
      },
    }),
  );
  writeFileSync(screenshotPath, "screenshot fixture");
  const attachments = [
    ...(options.delivery === false
      ? []
      : [
          {
            name: "publisher-image-delivery",
            contentType: "application/json",
            path: deliveryPath,
          },
        ]),
    ...(options.screenshot === false
      ? []
      : [
          {
            name: "detail-page",
            contentType: "image/png",
            path: screenshotPath,
          },
        ]),
  ];
  const result = (
    title: string,
    resultStatus: string,
    resultAttachments: { name: string; contentType: string; path: string }[] = [],
  ) => ({
    title,
    tests: [
      {
        expectedStatus: "passed",
        results: [{ status: resultStatus, attachments: resultAttachments }],
      },
    ],
  });
  return {
    errors: [],
    suites: [
      {
        title: "file",
        suites: [
          {
            title: "describe",
            specs: [
              result(
                "every prepared publisher photograph has a navigable venue id",
                "passed",
              ),
              result(
                `${entry.query.id}: ${entry.query.name}`,
                status,
                attachments,
              ),
            ],
          },
        ],
      },
    ],
  };
}

test("keeps a publisher photograph only after the real detail image decoded and evidence was captured", () => {
  const after = manifest([entry]);
  const result = reconcilePhotoDelivery({
    before: manifest([]),
    after,
    report: report(),
    checkedAt: image.checkedAt,
  });
  expect(result.manifest.entries[0].image).toEqual(image);
  expect(result.manifest.entries[0].deliveryVerifiedAt).toBe(image.checkedAt);
  expect(result.summary).toMatchObject({
    passed: 1,
    failed: 0,
    quarantined: 0,
    retainedPrior: 0,
  });
});

function inventoryOnly() {
  const inventory = report();
  inventory.suites[0].suites[0].specs.splice(1, 1);
  return inventory;
}

test("retains the original verification for an unchanged recently verified photograph without retesting", () => {
  const prior = { ...entry, deliveryVerifiedAt: "2026-10-01T00:00:00.000Z" };
  const result = reconcilePhotoDelivery({
    before: manifest([prior]),
    after: manifest([{ ...prior, deliveryVerifiedAt: image.checkedAt }]),
    report: inventoryOnly(),
    checkedAt: image.checkedAt,
  });
  expect(result.manifest.entries[0].deliveryVerifiedAt).toBe(
    prior.deliveryVerifiedAt,
  );
  expect(result.summary).toMatchObject({
    passed: 0,
    failed: 0,
    retainedVerified: 1,
  });
});

test("allows a completed inventory with no photographs requiring delivery checks", () => {
  const unresolved = { ...entry, image: null, status: "unresolved" };
  const result = reconcilePhotoDelivery({
    before: manifest([]),
    after: manifest([unresolved]),
    report: inventoryOnly(),
    checkedAt: image.checkedAt,
  });
  expect(result.manifest.entries).toEqual([unresolved]);
  expect(result.summary).toMatchObject({
    passed: 0,
    failed: 0,
    retainedVerified: 0,
  });
});

test("rejects an all-skipped inventory even when no photograph needs a delivery check", () => {
  const skipped = inventoryOnly();
  skipped.suites[0].suites[0].specs[0].tests[0].results[0].status = "skipped";
  expect(() =>
    reconcilePhotoDelivery({
      before: manifest([]),
      after: manifest([]),
      report: skipped,
      checkedAt: image.checkedAt,
    }),
  ).toThrow(/incomplete/i);
});

test("retains ten thousand recently verified photographs without requiring ten thousand hourly browser results", () => {
  const entries = Array.from({ length: 10_000 }, (_, index) => ({
    ...entry,
    query: { ...entry.query, id: `osm-node-${index}` },
    deliveryVerifiedAt: "2026-10-01T00:00:00.000Z",
  }));
  const result = reconcilePhotoDelivery({
    before: manifest(entries),
    after: manifest(entries),
    report: inventoryOnly(),
    checkedAt: image.checkedAt,
  });
  expect(result.summary).toMatchObject({
    passed: 0,
    failed: 0,
    retainedVerified: 10_000,
  });
  expect(
    result.manifest.entries.every(
      (item: { deliveryVerifiedAt?: string }) =>
        item.deliveryVerifiedAt === entries[0].deliveryVerifiedAt,
    ),
  ).toBe(true);
});

test.each([
  { deliveryVerifiedAt: "invalid" },
  { deliveryVerifiedAt: "2026-10-29T00:00:00.000Z" },
  { deliveryVerifiedAt: "2026-09-28T00:00:00.000Z" },
  {
    deliveryVerifiedAt: "2026-10-01T00:00:00.000Z",
    deliveryFailure: { reason: "failed" },
  },
])(
  "requires browser evidence for expired, invalid, future or previously failed verification %j",
  (extra) => {
    const prior = { ...entry, ...extra };
    expect(() =>
      reconcilePhotoDelivery({
        before: manifest([prior]),
        after: manifest([prior]),
        report: inventoryOnly(),
        checkedAt: image.checkedAt,
      }),
    ).toThrow(/missing browser result/i);
  },
);

test("requires fresh evidence when a verified venue image URL, source or stable identity changes", () => {
  const prior = { ...entry, deliveryVerifiedAt: "2026-10-01T00:00:00.000Z" };
  const replacements = [
    { ...prior, image: { ...image, url: `${image.url}?new=1` } },
    { ...prior, image: { ...image, source: `${image.source}new/` } },
    { ...prior, query: { ...entry.query, lat: 52 } },
  ];
  for (const replacement of replacements) {
    expect(() =>
      reconcilePhotoDelivery({
        before: manifest([prior]),
        after: manifest([replacement]),
        report: inventoryOnly(),
        checkedAt: image.checkedAt,
      }),
    ).toThrow(/missing browser result/i);
  }
});

test("requires screenshots only for the deterministic first twelve required delivery checks", () => {
  const entries = Array.from({ length: 13 }, (_, index) => ({
    ...entry,
    query: { ...entry.query, id: `osm-node-${index}` },
  }));
  const combined = report();
  const specs = combined.suites[0].suites[0].specs;
  specs.splice(1, 1);
  for (const [index, current] of entries.entries()) {
    const individual = report("passed", { screenshot: index < 12 });
    const spec = individual.suites[0].suites[0].specs[1];
    spec.title = `${current.query.id}: ${current.query.name}`;
    const delivery = spec.tests[0].results[0].attachments.find(
      (item) => item.name === "publisher-image-delivery",
    )!;
    const content = JSON.parse(readFileSync(delivery.path, "utf8"));
    writeFileSync(
      delivery.path,
      JSON.stringify({ ...content, id: current.query.id }),
    );
    specs.push(spec);
  }
  const result = reconcilePhotoDelivery({
    before: manifest([]),
    after: manifest(entries),
    report: combined,
    checkedAt: image.checkedAt,
  });
  expect(result.summary.passed).toBe(13);
  expect(
    result.manifest.entries.every(
      (item: { deliveryVerifiedAt?: string }) =>
        item.deliveryVerifiedAt === image.checkedAt,
    ),
  ).toBe(true);
});

test("quarantines a failed new photo while preserving unresolved website checkpoints", () => {
  const unresolved = {
    ...entry,
    query: { ...entry.query, id: "osm-node-456", name: "Another venue" },
    image: null,
    status: "unresolved",
  };
  const result = reconcilePhotoDelivery({
    before: manifest([]),
    after: manifest([entry, unresolved]),
    report: report("failed"),
    checkedAt: image.checkedAt,
  });
  expect(result.manifest.entries[0]).toMatchObject({
    image: null,
    status: "delivery-unavailable",
    retryable: true,
    deliveryFailure: { imageUrl: image.url, testStatus: "failed" },
  });
  expect(result.manifest.entries[0].evidence).toEqual(entry.evidence);
  expect(result.manifest.entries[1]).toEqual(unresolved);
  expect(result.summary).toMatchObject({
    passed: 0,
    failed: 1,
    quarantined: 1,
    retainedPrior: 0,
  });
});

test("restores a prior approved positive unchanged when its proposed replacement fails", () => {
  const prior = {
    ...entry,
    query: { ...entry.query, aliases: ["Pirates Play"] },
    checkedAt: "2026-10-01T00:00:00.000Z",
    image: {
      ...image,
      url: "https://pirateslanding.co.uk/previous-interior.jpg",
    },
  };
  const result = reconcilePhotoDelivery({
    before: manifest([prior]),
    after: manifest([entry]),
    report: report("timedOut"),
    checkedAt: image.checkedAt,
  });
  expect(result.manifest.entries[0].image).toEqual(prior.image);
  expect(result.manifest.entries[0].checkedAt).toBe(prior.checkedAt);
  expect(result.manifest.entries[0].deliveryFailure.testStatus).toBe(
    "timedOut",
  );
  expect(result.summary.retainedPrior).toBe(1);
});

test.each(["interrupted", "skipped"])(
  "refuses incomplete browser result %s without changing the candidate",
  (status) => {
    const after = manifest([entry]);
    expect(() =>
      reconcilePhotoDelivery({
        before: manifest([]),
        after,
        report: report(status),
      }),
    ).toThrow(/incomplete/i);
    expect(after.entries[0]).toEqual(entry);
  },
);

test("refuses browser fixture failures that never produced per-venue delivery evidence", () => {
  expect(() =>
    reconcilePhotoDelivery({
      before: manifest([]),
      after: manifest([entry]),
      report: report("failed", { delivery: false }),
    }),
  ).toThrow(/delivery evidence/i);
});

test("refuses application server failures instead of treating them as dead publishers", () => {
  expect(() =>
    reconcilePhotoDelivery({
      before: manifest([]),
      after: manifest([entry]),
      report: report("failed", { navigationStatus: 503 }),
    }),
  ).toThrow(/infrastructure|venue page/i);
});

test.each([{ decodedWidth: 0 }, { screenshot: false }])(
  "refuses passed assertions without usable image or screenshot evidence %j",
  (options) => {
    expect(() =>
      reconcilePhotoDelivery({
        before: manifest([]),
        after: manifest([entry]),
        report: report("passed", options),
      }),
    ).toThrow(/decoded|detail-page/i);
  },
);

test("refuses missing, duplicate and global-error reports", () => {
  expect(() =>
    reconcilePhotoDelivery({
      before: manifest([]),
      after: manifest([entry]),
      report: {},
    }),
  ).toThrow(/report/i);
  const duplicate = report();
  duplicate.suites[0].suites[0].specs.push(
    duplicate.suites[0].suites[0].specs[1],
  );
  expect(() =>
    reconcilePhotoDelivery({
      before: manifest([]),
      after: manifest([entry]),
      report: duplicate,
    }),
  ).toThrow(/duplicate/i);
  expect(() =>
    reconcilePhotoDelivery({
      before: manifest([]),
      after: manifest([entry]),
      report: { ...report(), errors: [{ message: "server failed" }] },
    }),
  ).toThrow(/infrastructure/i);
  const missing = report();
  missing.suites[0].suites[0].specs.splice(1, 1);
  expect(() =>
    reconcilePhotoDelivery({
      before: manifest([]),
      after: manifest([entry]),
      report: missing,
    }),
  ).toThrow(/missing/i);
});
