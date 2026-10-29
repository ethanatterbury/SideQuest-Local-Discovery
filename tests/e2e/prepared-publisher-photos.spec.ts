import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PLACES } from "../../src/providers/places";
import type { PreparedVenuePhotoEntry } from "../../src/providers/prepared-venue-photos";
import {
  photoDeliveryChecks,
  photoDeliveryUrlMatches,
  photoDeliverySelectionTime,
  photoNeedsDelivery,
} from "../../scripts/lib/photo-delivery-selection.mjs";

const manifest = JSON.parse(
  readFileSync("src/providers/data/venue-photo-previews.json", "utf8"),
) as { entries: PreparedVenuePhotoEntry[] };
const preparedPhotos = manifest.entries.filter(photoNeedsDelivery);
const before = process.env.SIDEQUEST_PHOTO_BASE_MANIFEST
  ? JSON.parse(readFileSync(process.env.SIDEQUEST_PHOTO_BASE_MANIFEST, "utf8"))
  : { version: 1, entries: [] };
const deliveryChecks = photoDeliveryChecks({
  before,
  after: manifest,
  now: photoDeliverySelectionTime(),
});

test("an open Geograph photo loads directly from Commons with photographer and licence links", async ({
  page,
}) => {
  const image = {
    url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Local_Park.jpg",
    source: "https://commons.wikimedia.org/wiki/File:Local_Park.jpg",
    credit: "Local photographer",
    license: "CC BY-SA 2.0",
    rights: "open" as const,
    strategy: "geograph-commons-source-id",
    checkedAt: "2026-10-28T00:00:00.000Z",
  };
  const place = {
    ...PLACES[0],
    id: "osm-node-987654321",
    name: "Local Park",
    image,
  };
  await page.route("**/data/venues/manifest.json", (route) =>
    route.fulfill({ json: { cells: {} } }),
  );
  await page.route("**/api/places?**", (route) =>
    route.fulfill({ json: { places: [], source: "live" } }),
  );
  await page.route(`**/api/places/${place.id}`, (route) =>
    route.fulfill({ json: place }),
  );
  const bytes = readFileSync("public/icons/icon-192.png");
  await page.route(image.url, (route) =>
    route.fulfill({ contentType: "image/png", body: bytes }),
  );
  let optimizerRequests = 0;
  await page.route("**/_next/image?**", (route) => {
    optimizerRequests++;
    return route.fulfill({
      contentType: "image/png",
      body: bytes,
    });
  });
  await page.goto(`/place/${place.id}`);
  await expect(
    page.getByRole("heading", { level: 1, name: place.name, exact: true }),
  ).toBeVisible();
  const photo = page.locator(".detail-hero img");
  await expect(photo).toBeVisible();
  await expect(photo).toHaveAttribute("src", image.url);
  expect(
    photoDeliveryUrlMatches(await photo.getAttribute("src"), image, page.url()),
  ).toBe(true);
  await expect
    .poll(() =>
      photo.evaluate(
        (element: HTMLImageElement) =>
          element.complete &&
          element.naturalWidth > 0 &&
          element.naturalHeight > 0,
      ),
    )
    .toBe(true);
  await expect(page.locator(".detail-hero .photo-source")).toHaveCount(0);
  const credit = page.locator(".image-credit");
  await expect(credit).toBeVisible();
  await expect(credit).toContainText(
    `Photo: ${image.credit} · ${image.license}`,
  );
  await expect(credit.getByRole("link").first()).toHaveAttribute(
    "href",
    image.source,
  );
  await expect(
    credit.getByRole("link", { name: "Licence", exact: true }),
  ).toHaveAttribute("href", "https://creativecommons.org/licenses/by-sa/2.0/");
  expect(optimizerRequests).toBe(0);
});

// These checks deliberately use the real image host network. Regular e2e runs
// stay deterministic; the maintenance workflow opts in after a production build.
test.describe("prepared publisher photographs on real detail pages", () => {
  test.skip(
    process.env.SIDEQUEST_LIVE_PHOTO_CHECK !== "1",
    "Set SIDEQUEST_LIVE_PHOTO_CHECK=1 to check real publisher image delivery",
  );
  test.describe.configure({ mode: "parallel" });
  test.use({ viewport: { width: 1280, height: 900 } });

  test("every prepared publisher photograph has a navigable venue id", () => {
    expect(
      preparedPhotos.every((entry) => Boolean(entry.query.id)),
      "Every prepared photograph needs a navigable venue id",
    ).toBe(true);
  });

  for (const { entry, screenshot } of deliveryChecks) {
    test(`${entry.query.id}: ${entry.query.name}`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(45_000);
      const image = entry.image!;
      const startedAt = Date.now();
      const delivery: Record<string, unknown> = {
        id: entry.query.id,
        name: entry.query.name,
        expectedImageUrl: image.url,
        source: image.source,
        screenshotSampled: screenshot,
        checkedAt: new Date(startedAt).toISOString(),
      };
      const imageResponses: { url: string; status: number }[] = [];
      const imageFailures: { url: string; error: string | null }[] = [];
      page.on("response", (response) => {
        if (response.request().resourceType() === "image")
          imageResponses.push({
            url: response.url(),
            status: response.status(),
          });
      });
      page.on("requestfailed", (request) => {
        if (request.resourceType() === "image")
          imageFailures.push({
            url: request.url(),
            error: request.failure()?.errorText ?? null,
          });
      });

      try {
        const response = await page.goto(
          `/place/${encodeURIComponent(entry.query.id!)}`,
          { waitUntil: "domcontentloaded", timeout: 15_000 },
        );
        delivery.navigationMs = Date.now() - startedAt;
        delivery.navigationStatus = response?.status();
        expect(response?.ok(), "The real venue detail route must load").toBe(
          true,
        );
        await expect(
          page.getByRole("heading", {
            level: 1,
            name: entry.query.name,
            exact: true,
          }),
        ).toBeVisible({ timeout: 10_000 });
        delivery.venueVisible = true;

        const hero = page.locator(".detail-hero");
        const photo = hero.getByRole("img", {
          name: entry.query.name,
          exact: true,
        });
        await expect(photo).toBeVisible({ timeout: 10_000 });
        expect(
          photoDeliveryUrlMatches(
            await photo.getAttribute("src"),
            image,
            page.url(),
          ),
          "The displayed photo must use this exact prepared image",
        ).toBe(true);
        await expect
          .poll(
            () =>
              photo.evaluate(
                (element: HTMLImageElement) =>
                  element.complete &&
                  element.naturalWidth > 0 &&
                  element.naturalHeight > 0,
              ),
            {
              timeout: 12_000,
              message: "The prepared photograph must decode",
            },
          )
          .toBe(true);
        await photo.evaluate(async (element: HTMLImageElement) => {
          await element.decode();
          if (element.naturalWidth <= 0 || element.naturalHeight <= 0)
            throw new Error("Prepared image decoded without usable dimensions");
        });
        delivery.imageDecodedMs = Date.now() - startedAt;
        if (image.rights === "website-preview")
          await expect(hero.locator(".photo-source")).toHaveText(
            `From ${image.credit}`,
          );
        else await expect(hero.locator(".photo-source")).toHaveCount(0);
        const credit = page.locator(".image-credit");
        await expect(credit).toBeVisible();
        await expect(credit).toContainText(
          image.rights === "website-preview" ? "Website preview:" : "Photo:",
        );
        await expect(credit.getByRole("link").first()).toHaveAttribute(
          "href",
          image.source,
        );
        await expect(credit).toContainText(image.credit);
        await expect(credit).toContainText(image.license);
        if (image.rights === "open" && image.license.startsWith("CC BY")) {
          const version = image.license.match(
            /\b(?:1\.0|2\.0|2\.5|3\.0|4\.0)\b/,
          )?.[0];
          await expect(
            credit.getByRole("link", { name: "Licence", exact: true }),
          ).toHaveAttribute(
            "href",
            version
              ? `https://creativecommons.org/licenses/${image.license.includes("SA") ? "by-sa" : "by"}/${version}/`
              : image.source,
          );
        }
      } finally {
        delivery.elapsedMs = Date.now() - startedAt;
        delivery.imageResponses = imageResponses;
        delivery.imageFailures = imageFailures;
        if (!page.isClosed()) {
          delivery.browser = await page
            .evaluate(() => ({
              pageUrl: location.href,
              credit: (() => {
                const credit =
                  document.querySelector<HTMLElement>(".image-credit");
                return credit
                  ? {
                      visible:
                        credit.getClientRects().length > 0 &&
                        getComputedStyle(credit).visibility !== "hidden",
                      text: credit.innerText,
                      links: Array.from(
                        credit.querySelectorAll<HTMLAnchorElement>("a"),
                      ).map((link) => ({
                        href: link.href,
                        text: link.innerText,
                      })),
                    }
                  : null;
              })(),
              hero: Array.from(
                document.querySelectorAll<HTMLImageElement>(".detail-hero img"),
              ).map((element) => ({
                src: element.src,
                currentSrc: element.currentSrc,
                complete: element.complete,
                naturalWidth: element.naturalWidth,
                naturalHeight: element.naturalHeight,
              })),
              resources: performance
                .getEntriesByType("resource")
                .filter(
                  (resource) =>
                    (resource as PerformanceResourceTiming).initiatorType ===
                    "img",
                )
                .map((resource) => ({
                  url: resource.name,
                  startTimeMs: resource.startTime,
                  durationMs: resource.duration,
                })),
            }))
            .catch((error: Error) => ({ error: error.message }));
          if (screenshot)
            try {
              await testInfo.attach("detail-page", {
                body: await page
                  .locator(".detail-hero")
                  .screenshot({ type: "jpeg", quality: 50, timeout: 5_000 }),
                contentType: "image/jpeg",
              });
            } catch (error) {
              delivery.screenshotError =
                error instanceof Error ? error.message : String(error);
            }
        }
        await testInfo.attach("publisher-image-delivery", {
          body: JSON.stringify(delivery, null, 2),
          contentType: "application/json",
        });
      }
    });
  }
});
