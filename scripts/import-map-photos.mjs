/** Offline media preparation from public place panels; never called while browsing the app. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { loadProvider } from "./lib/provider-loader.mjs";

const options = Object.fromEntries(
  process.argv.slice(2).map((value) => {
    const [key, ...parts] = value.replace(/^--/, "").split("=");
    return [key, parts.join("=") || "true"];
  }),
);
const integer = (name, fallback, maximum) => {
  const value = options[name] === undefined ? fallback : Number(options[name]);
  if (!Number.isInteger(value) || value < 0 || value > maximum)
    throw new Error(`Invalid --${name}`);
  return value;
};
const { normalizeOsmElement } = loadProvider("src/providers/nearby-places.ts");
const { PLACES } = loadProvider("src/providers/places.ts");
const { TOWNS } = loadProvider("src/providers/geocoding.ts");
const { placePhotoQuery } = loadProvider("src/providers/photo-index.ts");
const { assessMapPhotoEvidence, verifiedMapWebsite } = loadProvider(
  "src/providers/map-photo-evidence.ts",
);
const { downloadOfficialPhoto, resolveOfficialPhotos, safeOfficialPhotoUrl } =
  loadProvider("src/providers/official-photo.ts");
const readJson = async (file, fallback) => {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && fallback !== undefined) return fallback;
    throw error;
  }
};
const snapshot = await readJson("src/providers/data/regional-osm.json");
const catalogue = options.catalog
  ? await readJson(options.catalog)
  : [...PLACES, ...snapshot.elements.map(normalizeOsmElement).filter(Boolean)];
if (!Array.isArray(catalogue))
  throw new Error("The catalogue must be an array of normalized places");
const unique = [
  ...new Map(catalogue.map((place) => [place.id, place])).values(),
];
const indexPath = options.index || "src/providers/data/venue-media.json";
const index = await readJson(indexPath, {
  version: 1,
  generatedAt: null,
  entries: [],
});
const saved = new Map(index.entries.map((entry) => [entry.id, entry]));
const folder = options.work || "work/maps-import";
await mkdir(folder, { recursive: true });
const recordsPath = path.join(folder, "records.json");
const reportPath = path.join(folder, "report.json");
const checkpoint = await readJson(recordsPath, []);
const records = new Map(checkpoint.map((record) => [record.id, record]));
if (options.records)
  for (const file of options.records.split(",")) {
    const input = await readJson(file);
    const rows = Array.isArray(input) ? input : input.records;
    if (!Array.isArray(rows)) throw new Error(`Invalid records: ${file}`);
    for (const record of rows) records.set(record.id, record);
  }
const unmatched = options.records
  ? unique.filter((place) => records.has(place.id))
  : unique;
const selected = unmatched
  .filter((place) => options.replace === "true" || !saved.has(place.id))
  .slice(
    integer("offset", 0, unique.length),
    integer("offset", 0, unique.length) + integer("limit", 100, 100000),
  );
const report = {
  generatedAt: new Date().toISOString(),
  tested: selected.length,
  added: 0,
  stored: saved.size,
  outcomes: [],
};
const assets = [];
let browser;
let context;
let checkpointWrite = Promise.resolve();
const writeCheckpoint = () => {
  checkpointWrite = checkpointWrite.then(() =>
    writeFile(
      recordsPath,
      JSON.stringify([...records.values()], null, 2) + "\n",
    ),
  );
  return checkpointWrite;
};
const nearestTown = (place) =>
  TOWNS.toSorted(
    (a, b) =>
      (a.lat - place.coordinates.lat) ** 2 +
      (a.lng - place.coordinates.lng) ** 2 -
      ((b.lat - place.coordinates.lat) ** 2 +
        (b.lng - place.coordinates.lng) ** 2),
  )[0]?.name || "";

async function capture(place) {
  const page = await context.newPage();
  try {
    const deadline = Date.now() + 12000;
    const area =
      place.area && place.area !== "Nearby" ? place.area : nearestTown(place);
    await page.goto(
      `https://www.google.com/maps/search/${encodeURIComponent(`${place.name} ${area}`)}`,
      { timeout: 12000, waitUntil: "domcontentloaded" },
    );
    // A challenge or consent interstitial is a retryable failure; no circumvention.
    if (/\/sorry\//.test(page.url()) || /consent\.google\./.test(page.url()))
      throw new Error("maps-blocked-or-consent");
    await page
      .locator("h1.DUwDvf")
      .waitFor({ timeout: Math.max(1, deadline - Date.now()) });
    await page
      .waitForURL(
        (url) =>
          /\/maps\/place\//.test(url.pathname) && /!3d.*!4d/.test(url.pathname),
        { timeout: 3000 },
      )
      .catch(() => {});
    const panel = await page.evaluate(() => {
      const header = document.querySelector("h1.DUwDvf");
      const main = header?.closest('[role="main"]') || document;
      const images = [...main.querySelectorAll("img")]
        .filter((image) => {
          const box = image.getBoundingClientRect();
          return (
            box.width >= 200 && box.height >= 100 && image.checkVisibility()
          );
        })
        .map((image) => ({
          url: image.currentSrc || image.src,
          alt: image.alt || "",
        }))
        .filter(
          (image) =>
            /^https:\/\/lh[3-6]\.googleusercontent\.com\/(?:p|gps-cs-s|grass-cs)\//.test(
              image.url,
            ) ||
            /^https:\/\/streetviewpixels-pa\.googleapis\.com\/v1\/thumbnail\?/.test(
              image.url,
            ),
        );
      // The first large image is the photo header. Other panorama thumbnails do not establish subject identity.
      if (
        images[0]?.url.startsWith("https://streetviewpixels-pa.googleapis.com/")
      )
        images[0].context = "venue-header";
      return {
        title: header?.textContent?.trim() || "",
        images: images.slice(0, 20),
        website: main.querySelector('a[data-item-id="authority"]')?.href || "",
      };
    });
    return {
      id: place.id,
      name: place.name,
      lat: place.coordinates.lat,
      lng: place.coordinates.lng,
      area,
      url: page.url(),
      ...panel,
    };
  } finally {
    await page.close();
  }
}

async function store(place, record) {
  const evidence = assessMapPhotoEvidence(place, record);
  const website = verifiedMapWebsite(place, record);
  const outcome = {
    id: place.id,
    name: place.name,
    candidates: evidence.candidates.length,
    rejected: evidence.rejected,
    distanceMeters: evidence.distanceMeters,
    officialWebsite: website,
    status: "unavailable",
    retryable: false,
  };
  if (options["dry-run"] === "true")
    return {
      ...outcome,
      status: evidence.candidates.length
        ? "validated"
        : website
          ? "official-website-ready"
          : "unavailable",
    };
  const mapped = await attemptPhotos(place, evidence.candidates, outcome);
  if (mapped) return mapped;
  // Maps establishes the venue and its official link; the existing website adapter
  // then proves branch/photographic subject evidence and checks every public DNS hop.
  if (website && safeOfficialPhotoUrl(website)) {
    const query = placePhotoQuery(place);
    const official = await resolveOfficialPhotos({
      ...query,
      area: query.area === "Nearby" ? record.area || query.area : query.area,
      website,
    });
    outcome.officialFallback = {
      candidates: official.candidates.length,
      rejected: official.rejected,
      reason: official.reason,
      retryable: official.retryable,
    };
    outcome.retryable ||= official.retryable;
    const fallback = await attemptPhotos(place, official.candidates, outcome);
    if (fallback) return fallback;
  }
  return outcome;
}

async function attemptPhotos(place, photos, outcome) {
  for (const photo of photos.slice(0, 6)) {
    const downloaded = await downloadOfficialPhoto(photo.url);
    if (!downloaded) {
      outcome.retryable = true;
      continue;
    }
    try {
      const decoded = sharp(downloaded.buffer, {
        limitInputPixels: 40_000_000,
        failOn: "error",
      }).rotate();
      const info = await decoded.metadata(),
        stats = await decoded.stats();
      if (
        !info.width ||
        !info.height ||
        info.width < 400 ||
        info.height < 250 ||
        info.width / info.height > 4 ||
        info.height / info.width > 3 ||
        stats.entropy < 4.6 ||
        (info.hasAlpha && stats.channels[3]?.mean < 220)
      )
        continue;
      const { data, info: encoded } = await decoded
        .resize({ width: 1280, withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer({ resolveWithObject: true });
      if (!/^[a-zA-Z0-9_-]+$/.test(place.id))
        throw new Error("Unsafe place ID");
      const file = `${place.id}-${createHash("sha256").update(data).digest("hex").slice(0, 12)}.webp`;
      await writeFile(path.join(folder, file), data);
      const blur = await sharp(data)
        .resize({ width: 20 })
        .webp({ quality: 25 })
        .toBuffer();
      const { originalUrl = photo.url, ...image } = photo;
      const query = placePhotoQuery(place);
      saved.set(place.id, {
        id: place.id,
        name: place.name,
        lat: query.lat,
        lng: query.lng,
        originalUrl,
        downloadedUrl: downloaded.url,
        image: {
          ...image,
          url: `/venue-images/${file}`,
          width: encoded.width,
          height: encoded.height,
          blurDataURL: `data:image/webp;base64,${blur.toString("base64")}`,
        },
      });
      assets.push(file);
      return {
        ...outcome,
        status: "stored",
        strategy: photo.strategy,
        retryable: false,
        file,
      };
    } catch {
      /* Actual image decoding and quality checks determine eligibility. */
    }
  }
  return null;
}

try {
  if (!options.records && selected.some((place) => !records.has(place.id))) {
    const { chromium } = await import("@playwright/test");
    browser = await chromium.launch({
      headless: true,
      ...(options.executable ? { executablePath: options.executable } : {}),
    });
    context = await browser.newContext({
      locale: "en-GB",
      viewport: { width: 1440, height: 1000 },
    });
  }
  let cursor = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(integer("concurrency", 6, 6) || 1, selected.length) },
      async () => {
        while (cursor < selected.length) {
          const place = selected[cursor++];
          try {
            let record = records.get(place.id);
            if (!record) {
              record = await capture(place);
              records.set(place.id, record);
              await writeCheckpoint();
            }
            const outcome = await store(place, record);
            report.outcomes.push(outcome);
            console.log(JSON.stringify(outcome));
          } catch (error) {
            const outcome = {
              id: place.id,
              name: place.name,
              status: "retryable",
              retryable: true,
              reason: String(error.message).slice(0, 250),
            };
            report.outcomes.push(outcome);
            console.log(JSON.stringify(outcome));
          }
        }
      },
    ),
  );
  await writeCheckpoint();
  if (assets.length) {
    const archiveDirectory =
      options["archive-directory"] || "src/providers/data/venue-media-assets";
    await mkdir(archiveDirectory, { recursive: true });
    const stamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, "")
      .slice(0, 14);
    execFileSync("tar", [
      "-czf",
      path.join(archiveDirectory, `photos-maps-${stamp}.tar.gz`),
      "-C",
      folder,
      ...assets,
    ]);
    index.generatedAt = new Date().toISOString();
    index.entries = [...saved.values()];
    await writeFile(indexPath, JSON.stringify(index, null, 2) + "\n");
  }
  report.added = assets.length;
  report.stored = saved.size;
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({
      tested: report.tested,
      added: report.added,
      stored: report.stored,
      report: reportPath,
    }),
  );
} finally {
  await browser?.close();
}
