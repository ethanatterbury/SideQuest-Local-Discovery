import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { cpus, platform, release, tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const model = {
  id: "Xenova/clip-vit-base-patch32",
  revision: "d15189d7028b43f1d3e65039190477f6af591c2a",
  library: "@huggingface/transformers",
  libraryVersion: "3.8.1",
  dtype: "q8",
  device: "cpu",
};

// Generic prompts only: no venue IDs, names, URLs, or example-specific overrides.
const prompts = [
  { id: "venue-interior", group: "venue", text: "a photograph of a leisure venue interior, showing rooms, gym equipment, play structures or restaurant tables" },
  { id: "venue-exterior", group: "venue", text: "a photograph of a venue building exterior or its main visitor entrance" },
  { id: "outdoor-place", group: "venue", text: "a photograph of a public park, woodland, lake, nature reserve, sports field or playground" },
  { id: "logo-illustration", group: "reject", text: "a logo, cartoon, illustration or branded graphic banner" },
  { id: "portrait-event", group: "reject", text: "a close-up portrait, posed person, staff team or award presentation photograph" },
  { id: "product-food", group: "reject", text: "a close-up product, food or drink photograph" },
  { id: "ancillary-parking", group: "reject", text: "a photograph of a car park, parked cars, building service area or loading yard" },
  { id: "construction", group: "reject", text: "a photograph of a construction site, unfinished building or work crew" },
  { id: "document", group: "reject", text: "a poster, menu, screenshot, map or printed text" },
];
// Preregistered research settings, not a calibrated production approval threshold.
const defaultThreshold = { minScore: 0.5, minMargin: 0.15 };

/** Read only regular-file members of the existing tar archives, never extract paths. */
function archiveMembers(compressed) {
  const tar = gunzipSync(compressed, { maxOutputLength: 128 * 1024 * 1024 });
  const entries = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start, end) => header.subarray(start, end).toString("utf8").replace(/\0.*$/s, "");
    const size = Number.parseInt(field(124, 136).trim(), 8);
    assert(Number.isSafeInteger(size) && size >= 0, "Invalid tar member size");
    const storedChecksum = Number.parseInt(field(148, 156).trim(), 8);
    const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    assert.equal(checksum, storedChecksum, "Invalid tar header checksum");
    const start = offset + 512;
    assert(start + size <= tar.length, "Truncated tar member");
    if (header[156] === 0 || header[156] === 48) {
      const prefix = field(345, 500);
      const name = `${prefix ? `${prefix}/` : ""}${field(0, 100)}`;
      assert(!entries.has(name), "Duplicate tar member");
      entries.set(name, tar.subarray(start, start + size));
    }
    offset = start + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function decide(scores, threshold) {
  const bestVenue = Math.max(...scores.filter((score) => score.group === "venue").map((score) => score.score));
  const bestReject = Math.max(...scores.filter((score) => score.group === "reject").map((score) => score.score));
  const margin = bestVenue - bestReject;
  const decision = bestVenue >= threshold.minScore && margin >= threshold.minMargin
    ? "accept" : bestReject >= threshold.minScore && -margin >= threshold.minMargin ? "reject" : "abstain";
  return { decision, bestVenue, bestReject, margin };
}

function confusion(rows, threshold) {
  const matrix = Object.fromEntries(["accept", "reject", "abstain"].map((expected) => [expected, { accept: 0, reject: 0, abstain: 0 }]));
  const falseAccepts = [];
  for (const row of rows) {
    const actual = decide(row.scores, threshold).decision;
    matrix[row.expectedDecision][actual]++;
    if (row.expectedDecision === "reject" && actual === "accept") falseAccepts.push({ id: row.id, name: row.name, kind: row.kind });
  }
  const accepts = matrix.accept.accept + matrix.reject.accept;
  const rejects = matrix.reject.accept + matrix.reject.reject + matrix.reject.abstain;
  const good = matrix.accept.accept + matrix.accept.reject + matrix.accept.abstain;
  return {
    threshold, examples: rows.length,
    binaryLabelledExamples: good + rejects,
    diagnosticExamples: rows.length - good - rejects,
    diagnosticAccepts: matrix.abstain.accept,
    matrix, falseAccepts,
    falseAcceptRate: rejects ? matrix.reject.accept / rejects : null,
    precisionAmongAcceptedBinaryLabels: accepts ? matrix.accept.accept / accepts : null,
    acceptedGoodPhotoRecall: good ? matrix.accept.accept / good : null,
    abstentions: rows.filter((row) => decide(row.scores, threshold).decision === "abstain").length,
  };
}

const datasetBytes = await readFile(join(here, "dataset.json"));
const dataset = JSON.parse(datasetBytes);
const media = JSON.parse(await readFile(join(root, "src/providers/data/venue-media.json"), "utf8"));
const archives = new Map();
const ids = new Set();
const hashes = new Set();
assert(dataset.entries.length >= 20 && dataset.entries.length <= 30, "Pilot must remain bounded to 20–30 examples");
for (const entry of dataset.entries) {
  assert(!ids.has(entry.id) && !hashes.has(entry.renditionSha256), "Duplicate example or rendition");
  ids.add(entry.id); hashes.add(entry.renditionSha256);
  assert(["accept", "reject", "abstain"].includes(entry.expectedDecision));
  assert(["calibration", "holdout", "diagnostic"].includes(entry.split));
  assert.equal(entry.review.method, "view_image");
  assert(entry.review.description && entry.review.provenance && entry.credit && entry.license);
  assert(/^photos-[a-z0-9-]+\.tar\.gz$/.test(entry.archive));
  assert(/^[a-z0-9-]+\.webp$/.test(entry.member));
  const original = media.entries.find((item) => item.id === entry.id);
  assert(original, `Missing source metadata: ${entry.id}`);
  assert.equal(original.originalUrl, entry.originalUrl);
  assert.equal(original.image.url, `/venue-images/${entry.member}`);
  assert.equal(original.image.source, entry.sourcePage);
  assert.equal(original.image.license, entry.license);
  if (!archives.has(entry.archive)) archives.set(entry.archive, archiveMembers(await readFile(join(root, "src/providers/data/venue-media-assets", entry.archive))));
  const bytes = archives.get(entry.archive).get(entry.member);
  assert(bytes, `Missing archived rendition: ${entry.member}`);
  assert.equal(sha256(bytes), entry.renditionSha256, `Reviewed bytes changed: ${entry.id}`);
}
if (process.argv.includes("--validate")) {
  console.log(JSON.stringify({ status: "validated", examples: dataset.entries.length, labels: Object.fromEntries(["accept", "reject", "abstain"].map((label) => [label, dataset.entries.filter((entry) => entry.expectedDecision === label).length])), datasetSha256: sha256(datasetBytes), networkRequests: 0 }));
  process.exit(0);
}
const offline = process.argv.includes("--offline");
for (const arg of process.argv.slice(2)) assert(["--offline"].includes(arg), `Unknown argument: ${arg}`);
const outputDir = resolve(process.env.PHOTO_VISION_OUTPUT_DIR || join(root, "work/photo-vision-pilot"));
const cacheDir = resolve(process.env.PHOTO_VISION_CACHE_DIR || join(root, "work/photo-vision-model-cache"));
await mkdir(outputDir, { recursive: true });
const ephemeral = await mkdtemp(join(tmpdir(), "sidequest-photo-vision-"));
const report = {
  version: 1, status: "running", generatedAt: new Date().toISOString(), model,
  datasetSha256: sha256(datasetBytes), dataset: { ...dataset, entries: undefined },
  defaultThreshold, prompts, offline, runtime: { node: process.version, platform: platform(), release: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length },
  limits: ["Tiny convenience sample; not England coverage or a validated production approval policy.", "Scores are relative text/image similarities, not probabilities that a venue identity or photo caption is correct.", "Images can be real photographs but unsuitable, stale, misidentified or subject to reuse restrictions.", "Calibration exploration uses calibration examples only; holdout uses the preregistered default threshold."],
  results: [],
};
let classifier;
try {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.cacheDir = cacheDir;
  env.allowRemoteModels = !offline;
  // Offline cache reads require local loading to remain enabled in Transformers.js.
  env.allowLocalModels = true;
  // Never enable remote executable code; use the library's built-in CLIP implementation.
  const loadStart = performance.now();
  classifier = await pipeline("zero-shot-image-classification", model.id, {
    revision: model.revision, dtype: model.dtype, device: model.device,
    session_options: { intraOpNumThreads: Math.min(2, cpus().length), interOpNumThreads: 1 },
  });
  report.modelLoadMs = performance.now() - loadStart;
  // All inference below is offline, including first-run CI after the model bootstrap.
  env.allowRemoteModels = false;
  for (const entry of dataset.entries) {
    const file = join(ephemeral, entry.member);
    await writeFile(file, archives.get(entry.archive).get(entry.member));
    const started = performance.now();
    const output = await classifier(file, prompts.map((prompt) => prompt.text), { hypothesis_template: "{}" });
    const inferenceMs = performance.now() - started;
    const scores = output.map((item) => {
      const prompt = prompts.find((prompt) => prompt.text === item.label);
      assert(prompt && Number.isFinite(item.score), "Invalid model scores");
      return { id: prompt.id, group: prompt.group, score: item.score };
    });
    const row = { ...entry, inferenceMs, scores, ...decide(scores, defaultThreshold) };
    report.results.push(row);
    await rm(file);
    console.log(JSON.stringify({ id: row.id, expected: row.expectedDecision, decision: row.decision, split: row.split, inferenceMs, bestVenue: row.bestVenue, bestReject: row.bestReject, margin: row.margin }));
  }
  const calibration = report.results.filter((row) => row.split === "calibration");
  report.evaluation = {
    all: confusion(report.results, defaultThreshold),
    calibration: confusion(calibration, defaultThreshold),
    holdout: confusion(report.results.filter((row) => row.split === "holdout"), defaultThreshold),
    calibrationGrid: [0.3, 0.4, 0.5, 0.6, 0.7].flatMap((minScore) => [0.05, 0.1, 0.15, 0.2].map((minMargin) => confusion(calibration, { minScore, minMargin }))),
  };
  const times = report.results.map((row) => row.inferenceMs).sort((a, b) => a - b);
  const warmTimes = report.results.slice(1).map((row) => row.inferenceMs);
  const meanMs = warmTimes.reduce((sum, time) => sum + time, 0) / warmTimes.length;
  report.performance = {
    firstImageMs: report.results[0].inferenceMs, warmMeanMs: meanMs,
    medianMs: times[Math.floor(times.length / 2)], p95Ms: times[Math.ceil(times.length * 0.95) - 1],
    peakRssBytes: process.resourceUsage().maxRSS * 1024,
    serialInferenceProjection: [1000, 100000].map((images) => ({ images, hours: images * meanMs / 3600000 })),
    projectionCaveat: "Linear CPU inference estimate only; excludes image download, parsing, source checks and runner queue/cost. Shared CI compute is limited and is not unlimited free hosting.",
  };
  report.status = "completed";
} catch (error) {
  report.status = "failed";
  report.error = { name: error.name, message: error.message };
  process.exitCode = 1;
} finally {
  await classifier?.dispose();
  await rm(ephemeral, { recursive: true, force: true });
  await writeFile(join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, examples: report.results.length, report: join(outputDir, "report.json"), evaluation: report.evaluation?.all, performance: report.performance, error: report.error }));
}
