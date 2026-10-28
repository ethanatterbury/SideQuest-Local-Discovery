import { afterEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
    resultAttachments: unknown[] = [],
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
  expect(result.summary).toMatchObject({
    passed: 1,
    failed: 0,
    quarantined: 0,
    retainedPrior: 0,
  });
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
