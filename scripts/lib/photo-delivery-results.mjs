/** Reconcile real browser delivery evidence without losing other batch checkpoints. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadProvider } from "./provider-loader.mjs";
import {
  photoDeliveryChecks,
  photoDeliverySelectionTime,
} from "./photo-delivery-selection.mjs";

const { approvedPhoto } = loadProvider("src/providers/photo-policy.ts");
const { websiteDiscoveryIdentity } = loadProvider(
  "src/providers/prepared-venue-photos.ts",
);
const INVENTORY =
  "every prepared publisher photograph has a navigable venue id";

function specsIn(suite) {
  return [...(suite.specs ?? []), ...(suite.suites ?? []).flatMap(specsIn)];
}

function resultFor(specs, title) {
  const matches = specs.filter((spec) => spec.title === title);
  assert.equal(
    matches.length,
    1,
    `${matches.length ? "Duplicate" : "Missing"} browser result: ${title}`,
  );
  const tests = matches[0].tests;
  assert.ok(
    Array.isArray(tests) && tests.length === 1,
    `Incomplete browser result: ${title}`,
  );
  const test = tests[0];
  const result = test.results?.at(-1);
  assert.equal(
    test.expectedStatus,
    "passed",
    `Incomplete expected browser status: ${title}`,
  );
  assert.ok(
    result && ["passed", "failed", "timedOut"].includes(result.status),
    `Incomplete browser result: ${title}`,
  );
  return result;
}

function attachment(result, name) {
  const matches = (result.attachments ?? []).filter(
    (item) => item.name === name,
  );
  assert.equal(
    matches.length,
    1,
    `Missing or duplicate ${name} delivery evidence`,
  );
  const item = matches[0];
  if (item.path) return readFileSync(item.path);
  assert.ok(
    typeof item.body === "string",
    `Missing ${name} delivery evidence bytes`,
  );
  return Buffer.from(item.body, "base64");
}

export function reconcilePhotoDelivery({
  before,
  after,
  report,
  checkedAt = new Date().toISOString(),
}) {
  assert.ok(
    report && Array.isArray(report.suites) && Array.isArray(report.errors),
    "Invalid or missing Playwright report",
  );
  assert.equal(
    report.errors.length,
    0,
    "Browser infrastructure errors prevent publication",
  );
  assert.ok(
    before?.version === 1 && Array.isArray(before.entries),
    "Invalid previous manifest",
  );
  assert.ok(
    after?.version === 1 && Array.isArray(after.entries),
    "Invalid candidate manifest",
  );
  const now = Date.parse(checkedAt);
  assert.ok(Number.isFinite(now), "Invalid photo delivery reconciliation time");
  const specs = report.suites.flatMap(specsIn);
  assert.equal(
    resultFor(specs, INVENTORY).status,
    "passed",
    "Catalogue browser inventory failed",
  );
  const previous = new Map(
    before.entries.map((entry) => [
      websiteDiscoveryIdentity(entry.query),
      entry,
    ]),
  );
  const required = new Map(
    photoDeliveryChecks({
      before,
      after,
      now,
    }).map((check) => [websiteDiscoveryIdentity(check.entry.query), check]),
  );
  const summary = {
    passed: 0,
    failed: 0,
    quarantined: 0,
    retainedPrior: 0,
    retainedVerified: 0,
    failures: [],
  };
  const entries = after.entries.map((entry) => {
    if (entry.image?.rights !== "website-preview") return entry;
    const identity = websiteDiscoveryIdentity(entry.query);
    const check = required.get(identity);
    if (!check) {
      summary.retainedVerified++;
      return {
        ...entry,
        deliveryVerifiedAt: previous.get(identity).deliveryVerifiedAt,
      };
    }
    const title = `${entry.query.id}: ${entry.query.name}`;
    const result = resultFor(specs, title);
    const delivery = JSON.parse(
      attachment(result, "publisher-image-delivery").toString("utf8"),
    );
    assert.equal(
      delivery.id,
      entry.query.id,
      `Mismatched delivery evidence: ${title}`,
    );
    assert.equal(
      delivery.expectedImageUrl,
      entry.image.url,
      `Mismatched delivery image: ${title}`,
    );
    assert.equal(
      delivery.source,
      entry.image.source,
      `Mismatched delivery source: ${title}`,
    );
    assert.ok(
      Number.isFinite(delivery.elapsedMs),
      `Incomplete delivery evidence: ${title}`,
    );
    assert.ok(
      delivery.navigationStatus === 200 && delivery.venueVisible === true,
      `Browser infrastructure or venue page failure: ${title}`,
    );
    if (result.status === "passed") {
      assert.ok(
        delivery.browser?.hero?.some(
          (image) =>
            image.complete === true &&
            image.naturalWidth > 0 &&
            image.naturalHeight > 0 &&
            image.src === entry.image.url &&
            image.currentSrc === entry.image.url,
        ),
        `No decoded publisher photograph in browser evidence: ${title}`,
      );
      if (check.screenshot)
        assert.ok(
          attachment(result, "detail-page").length > 0,
          `Missing screenshot evidence: ${title}`,
        );
      summary.passed++;
      const verified = { ...entry, deliveryVerifiedAt: checkedAt };
      delete verified.deliveryFailure;
      return verified;
    }
    summary.failed++;
    const failure = {
      checkedAt,
      imageUrl: entry.image.url,
      testStatus: result.status,
      reason: "publisher-image-delivery-failed",
      elapsedMs: delivery.elapsedMs,
      failures: (delivery.imageFailures ?? []).slice(0, 10),
    };
    summary.failures.push({
      id: entry.query.id,
      name: entry.query.name,
      ...failure,
    });
    const prior = previous.get(identity);
    if (approvedPhoto(prior?.image, prior?.checkedAt)) {
      summary.retainedPrior++;
      return { ...prior, deliveryFailure: failure };
    }
    summary.quarantined++;
    const quarantined = {
      ...entry,
      image: null,
      retryable: true,
      status: "delivery-unavailable",
      deliveryFailure: failure,
    };
    delete quarantined.deliveryVerifiedAt;
    return quarantined;
  });
  return { manifest: { ...after, entries }, summary };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const options = new Map(
    process.argv.slice(2).map((value) => {
      const match = /^--(before|after|results|summary)=(.+)$/.exec(value);
      assert.ok(match, `Unknown argument: ${value}`);
      return [match[1], match[2]];
    }),
  );
  for (const key of ["before", "after", "results", "summary"])
    assert.ok(options.get(key), `Missing --${key}`);
  const read = (key) => JSON.parse(readFileSync(options.get(key), "utf8"));
  const result = reconcilePhotoDelivery({
    before: read("before"),
    after: read("after"),
    report: read("results"),
    checkedAt: new Date(photoDeliverySelectionTime()).toISOString(),
  });
  // Compute the complete reconciliation before writing either artifact.
  writeFileSync(
    options.get("after"),
    JSON.stringify(result.manifest, null, 2) + "\n",
  );
  writeFileSync(
    options.get("summary"),
    JSON.stringify(result.summary, null, 2) + "\n",
  );
  console.log(JSON.stringify(result.summary));
}
