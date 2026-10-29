import { afterEach, expect, test, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reconcilePhotoDelivery } from "../scripts/lib/photo-delivery-results.mjs";

const folders: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  folders
    .splice(0)
    .forEach((folder) => rmSync(folder, { recursive: true, force: true }));
});

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
const openImage = {
  url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Pirates_Landing.jpg",
  source: "https://commons.wikimedia.org/wiki/File:Pirates_Landing.jpg",
  credit: "Local photographer",
  license: "CC BY-SA 2.0",
  rights: "open",
  strategy: "geograph-commons-source-id",
  checkedAt: image.checkedAt,
};
const openEntry = { ...entry, image: openImage };
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
    image?: typeof image | typeof openImage;
  } = {},
) {
  const expectedImage = options.image ?? image;
  const folder = mkdtempSync(join(tmpdir(), "photo-delivery-results-"));
  folders.push(folder);
  const deliveryPath = join(folder, "delivery.json");
  const screenshotPath = join(folder, "detail.png");
  writeFileSync(
    deliveryPath,
    JSON.stringify({
      id: entry.query.id,
      expectedImageUrl: expectedImage.url,
      source: expectedImage.source,
      navigationStatus: options.navigationStatus ?? 200,
      venueVisible: true,
      imageDecodedMs: status === "passed" ? 400 : undefined,
      elapsedMs: 500,
      imageFailures:
        status === "passed"
          ? []
          : [{ url: expectedImage.url, error: "net::ERR_FAILED" }],
      browser: {
        pageUrl: `http://localhost:3000/place/${entry.query.id}`,
        hero:
          status === "passed"
            ? [
                {
                  src: expectedImage.url,
                  currentSrc: expectedImage.url,
                  complete: true,
                  naturalWidth: options.decodedWidth ?? 1280,
                  naturalHeight: 800,
                },
              ]
            : [],
        credit: {
          visible: true,
          text: `Photo: ${expectedImage.credit} · ${expectedImage.license}. Cropped for display.`,
          links: [
            {
              href: expectedImage.source,
              text: `${expectedImage.credit} · ${expectedImage.license}`,
            },
            {
              href: "https://creativecommons.org/licenses/by-sa/2.0/",
              text: "Licence",
            },
          ],
        },
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
    resultAttachments: {
      name: string;
      contentType: string;
      path: string;
    }[] = [],
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

test.each([
  "missing-decode",
  "missing-attachment",
  "mismatched-source",
  "missing-screenshot",
])(
  "quarantines only an incomplete photo proof and publishes other verified photos: %s",
  (problem) => {
    const good = report();
    const bad = report();
    const badEntry = {
      ...entry,
      query: { ...entry.query, id: "osm-node-456", name: "Another venue" },
    };
    const spec = bad.suites[0].suites[0].specs[1];
    spec.title = `${badEntry.query.id}: ${badEntry.query.name}`;
    const attachments = spec.tests[0].results[0].attachments;
    const path = attachments.find(
      (item) => item.name === "publisher-image-delivery",
    )!.path;
    const delivery = JSON.parse(readFileSync(path, "utf8"));
    delivery.id = badEntry.query.id;
    if (problem === "missing-decode") delivery.browser.hero = [];
    if (problem === "mismatched-source")
      delivery.source = "https://other-venue.co.uk/";
    if (problem === "missing-attachment") attachments.splice(0, 1);
    if (problem === "missing-screenshot") attachments.splice(1, 1);
    writeFileSync(path, JSON.stringify(delivery));
    good.suites[0].suites[0].specs.push(spec);
    const result = reconcilePhotoDelivery({
      before: manifest([]),
      after: manifest([entry, badEntry]),
      report: good,
      checkedAt: image.checkedAt,
    });
    expect(result.summary).toMatchObject({
      passed: 1,
      failed: 1,
      quarantined: 1,
      retainedPrior: 0,
    });
    expect(result.manifest.entries[0]).toMatchObject({
      image,
      deliveryVerifiedAt: image.checkedAt,
    });
    expect(result.manifest.entries[1]).toMatchObject({
      image: null,
      retryable: true,
      deliveryFailure: {
        testStatus: "passed",
        reason: "incomplete-photo-delivery-evidence",
      },
    });
    expect(result.manifest.entries[1].deliveryVerifiedAt).toBeUndefined();
  },
);

test.each(["2026-10-29T02:50:14.000Z", "invalid"])(
  "honours an explicit reconciliation time regardless of workflow environment %s",
  (configuredTime) => {
    vi.stubEnv("SIDEQUEST_PHOTO_DELIVERY_AT", configuredTime);
    const prior = { ...entry, deliveryVerifiedAt: "2026-10-29T00:00:00.000Z" };
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

test("the publication CLI uses the same immutable workflow time as browser selection", () => {
  const folder = mkdtempSync(join(tmpdir(), "photo-delivery-cli-"));
  folders.push(folder);
  const configuredTime = "2026-10-29T02:50:14.000Z";
  const paths = Object.fromEntries(
    ["before", "after", "results", "summary"].map((key) => [
      key,
      join(folder, `${key}.json`),
    ]),
  );
  writeFileSync(paths.before, JSON.stringify(manifest([])));
  writeFileSync(paths.after, JSON.stringify(manifest([entry])));
  writeFileSync(paths.results, JSON.stringify(report()));
  const result = spawnSync(
    process.execPath,
    [
      "scripts/lib/photo-delivery-results.mjs",
      ...Object.entries(paths).map(([key, path]) => `--${key}=${path}`),
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, SIDEQUEST_PHOTO_DELIVERY_AT: configuredTime },
      encoding: "utf8",
    },
  );
  expect(result.status, result.stderr).toBe(0);
  const published = JSON.parse(readFileSync(paths.after, "utf8"));
  expect(published.entries[0].deliveryVerifiedAt).toBe(configuredTime);
});

test("rejects an invalid explicit reconciliation time before retaining browser proof", () => {
  const prior = { ...entry, deliveryVerifiedAt: "2026-10-01T00:00:00.000Z" };
  expect(() =>
    reconcilePhotoDelivery({
      before: manifest([prior]),
      after: manifest([prior]),
      report: inventoryOnly(),
      checkedAt: "invalid",
    }),
  ).toThrow(/invalid photo delivery reconciliation time/i);
});

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
    {
      ...prior,
      image: {
        ...image,
        source: `${image.source}new/`,
        preview: { ...image.preview, pageUrl: `${image.source}new/` },
      },
    },
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

test("requires browser evidence before publishing a new open Geograph photo", () => {
  expect(() =>
    reconcilePhotoDelivery({
      before: manifest([]),
      after: manifest([openEntry]),
      report: inventoryOnly(),
      checkedAt: image.checkedAt,
    }),
  ).toThrow(/missing browser result/i);
});

test.each([false, true])(
  "publishes open Geograph photos after direct or optimized decode and attribution evidence (optimized: %s)",
  (optimized) => {
    const browser = report("passed", { image: openImage });
    if (optimized) {
      const path =
        browser.suites[0].suites[0].specs[1].tests[0].results[0].attachments[0]
          .path;
      const delivery = JSON.parse(readFileSync(path, "utf8"));
      const url = `http://localhost:3000/_next/image?url=${encodeURIComponent(openImage.url)}&w=1920&q=75`;
      delivery.browser.hero[0].src = url;
      delivery.browser.hero[0].currentSrc = url;
      writeFileSync(path, JSON.stringify(delivery));
    }
    const result = reconcilePhotoDelivery({
      before: manifest([]),
      after: manifest([openEntry]),
      report: browser,
      checkedAt: image.checkedAt,
    });
    expect(result.manifest.entries[0]).toMatchObject({
      image: openImage,
      deliveryVerifiedAt: image.checkedAt,
    });
    expect(result.summary.passed).toBe(1);
  },
);

test("retains the original timestamp of unchanged verified open Geograph photos", () => {
  const prior = {
    ...openEntry,
    deliveryVerifiedAt: "2026-10-01T00:00:00.000Z",
  };
  const result = reconcilePhotoDelivery({
    before: manifest([prior]),
    after: manifest([{ ...prior, deliveryVerifiedAt: image.checkedAt }]),
    report: inventoryOnly(),
    checkedAt: image.checkedAt,
  });
  expect(result.summary.retainedVerified).toBe(1);
  expect(result.manifest.entries[0].deliveryVerifiedAt).toBe(
    prior.deliveryVerifiedAt,
  );
});

test.each([false, true])(
  "quarantines a failed new open image or restores its prior approved image (prior: %s)",
  (hasPrior) => {
    const prior = {
      ...openEntry,
      image: {
        ...openImage,
        url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Prior.jpg",
      },
    };
    const result = reconcilePhotoDelivery({
      before: manifest(hasPrior ? [prior] : []),
      after: manifest([openEntry]),
      report: report("failed", { image: openImage }),
      checkedAt: image.checkedAt,
    });
    expect(result.summary.failed).toBe(1);
    expect(result.manifest.entries[0].image).toEqual(
      hasPrior ? prior.image : null,
    );
    expect(result.summary).toMatchObject({
      retainedPrior: Number(hasPrior),
      quarantined: Number(!hasPrior),
    });
  },
);

test.each(["missing", "wrong-credit", "wrong-source", "hidden"])(
  "quarantines passed open-photo checks without exact visible attribution evidence %s",
  (problem) => {
    const browser = report("passed", { image: openImage });
    const path =
      browser.suites[0].suites[0].specs[1].tests[0].results[0].attachments[0]
        .path;
    const delivery = JSON.parse(readFileSync(path, "utf8"));
    if (problem === "missing") delete delivery.browser.credit;
    if (problem === "wrong-credit")
      delivery.browser.credit.text =
        "Photo: Incorrect photographer · CC BY-SA 2.0";
    if (problem === "wrong-source")
      delivery.browser.credit.links[0].href =
        "https://commons.wikimedia.org/wiki/File:Other.jpg";
    if (problem === "hidden") delivery.browser.credit.visible = false;
    writeFileSync(path, JSON.stringify(delivery));
    const result = reconcilePhotoDelivery({
      before: manifest([]),
      after: manifest([openEntry]),
      report: browser,
      checkedAt: image.checkedAt,
    });
    expect(result.manifest.entries[0].image).toBeNull();
    expect(result.summary.failures[0]).toMatchObject({
      reason: "incomplete-photo-delivery-evidence",
      testStatus: "passed",
    });
    expect(result.summary.failures[0].failures[0].error).toMatch(
      /attribution/i,
    );
  },
);

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

test("quarantines a completed browser test that produced no per-venue delivery evidence", () => {
  const result = reconcilePhotoDelivery({
    before: manifest([]),
    after: manifest([entry]),
    report: report("failed", { delivery: false }),
  });
  expect(result.manifest.entries[0].image).toBeNull();
  expect(result.summary.failures[0]).toMatchObject({
    reason: "incomplete-photo-delivery-evidence",
    testStatus: "failed",
  });
  expect(result.summary.failures[0].failures[0].error).toMatch(
    /delivery evidence/i,
  );
});

test("quarantines a failed venue navigation without approving its publisher image", () => {
  const result = reconcilePhotoDelivery({
    before: manifest([]),
    after: manifest([entry]),
    report: report("failed", { navigationStatus: 503 }),
  });
  expect(result.manifest.entries[0].image).toBeNull();
  expect(result.summary.failures[0].reason).toBe(
    "incomplete-photo-delivery-evidence",
  );
  expect(result.summary.failures[0].failures[0].error).toMatch(
    /infrastructure|venue page/i,
  );
});

test.each([{ decodedWidth: 0 }, { screenshot: false }])(
  "quarantines passed assertions without usable image or screenshot evidence %j",
  (options) => {
    const result = reconcilePhotoDelivery({
      before: manifest([]),
      after: manifest([entry]),
      report: report("passed", options),
    });
    expect(result.manifest.entries[0].image).toBeNull();
    expect(result.summary.failures[0]).toMatchObject({
      reason: "incomplete-photo-delivery-evidence",
      testStatus: "passed",
    });
    expect(result.summary.failures[0].failures[0].error).toMatch(
      /decoded|detail-page/i,
    );
  },
);

test("retains a prior approved photo when a replacement passes without valid decode proof", () => {
  const prior = {
    ...entry,
    image: { ...image, url: "https://pirateslanding.co.uk/prior.jpg" },
    deliveryVerifiedAt: "2026-10-01T00:00:00.000Z",
  };
  const result = reconcilePhotoDelivery({
    before: manifest([prior]),
    after: manifest([entry]),
    report: report("passed", { decodedWidth: 0 }),
    checkedAt: image.checkedAt,
  });
  expect(result.manifest.entries[0]).toMatchObject({
    image: prior.image,
    deliveryVerifiedAt: prior.deliveryVerifiedAt,
    deliveryFailure: {
      reason: "incomplete-photo-delivery-evidence",
      testStatus: "passed",
    },
  });
  expect(result.summary).toMatchObject({
    passed: 0,
    failed: 1,
    retainedPrior: 1,
    quarantined: 0,
  });
});

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
