import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { PreparedVenuePhotoEntry } from "../../src/providers/prepared-venue-photos";

const manifest = JSON.parse(
  readFileSync("src/providers/data/venue-photo-previews.json", "utf8"),
) as { entries: PreparedVenuePhotoEntry[] };
const publisherPhotos = manifest.entries.filter(
  (entry) => entry.image?.rights === "website-preview",
);

// These checks deliberately use the real publisher network. Regular e2e runs
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
      publisherPhotos.every((entry) => Boolean(entry.query.id)),
      "Every prepared publisher photograph needs a navigable venue id",
    ).toBe(true);
  });

  for (const entry of publisherPhotos) {
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
        await expect(photo).toHaveAttribute("src", image.url);
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
              message: "The publisher photograph must decode",
            },
          )
          .toBe(true);
        await photo.evaluate(async (element: HTMLImageElement) => {
          await element.decode();
          if (element.naturalWidth <= 0 || element.naturalHeight <= 0)
            throw new Error(
              "Publisher image decoded without usable dimensions",
            );
        });
        delivery.imageDecodedMs = Date.now() - startedAt;
        await expect(hero.locator(".photo-source")).toHaveText(
          `From ${image.credit}`,
        );
        const credit = page.locator(".image-credit");
        await expect(credit).toContainText("Website preview");
        await expect(credit.getByRole("link").first()).toHaveAttribute(
          "href",
          image.source,
        );
        await expect(credit).toContainText(image.credit);
      } finally {
        delivery.elapsedMs = Date.now() - startedAt;
        delivery.imageResponses = imageResponses;
        delivery.imageFailures = imageFailures;
        if (!page.isClosed()) {
          delivery.browser = await page
            .evaluate(() => ({
              pageUrl: location.href,
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
          try {
            await testInfo.attach("detail-page", {
              body: await page.screenshot({ fullPage: true, timeout: 5_000 }),
              contentType: "image/png",
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
