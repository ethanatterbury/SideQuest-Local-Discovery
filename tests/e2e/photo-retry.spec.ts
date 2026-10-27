import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PLACES } from "../../src/providers/places";

test("a visible card retries a temporary photo failure without reloading the page", async ({
  page,
}) => {
  const place = {
    ...PLACES[0],
    id: "transient-photo-museum",
    name: "Retry Photo Museum",
    category: "Museum",
    environment: "indoor",
    daylightOnly: false,
    coordinates: { lat: 51.347, lng: -0.8 },
    image: undefined,
  };
  const image = {
    url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Venue.jpg",
    source: "https://commons.wikimedia.org/wiki/File:Venue.jpg",
    credit: "Photographer",
    license: "CC0",
    checkedAt: "2026-10-27",
  };
  await page.clock.install();
  await page.route("**/data/venues/manifest.json", (route) =>
    route.fulfill({ json: { cells: {} } }),
  );
  await page.route("**/api/places?**", (route) =>
    route.fulfill({ json: { places: [place], source: "live" } }),
  );
  let attempts = 0;
  await page.route("**/api/photo?**", (route) => {
    if (new URL(route.request().url()).searchParams.get("id") !== place.id)
      return route.fulfill({ json: { image: null } });
    attempts++;
    return attempts === 1
      ? route.fulfill({ status: 503, body: "Try later" })
      : route.fulfill({ json: { image } });
  });
  await page.route("**/_next/image?**", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: readFileSync("public/icons/icon-192.png"),
    }),
  );
  await page.goto("/explore");
  const card = page
    .locator(".results-grid > article")
    .filter({ has: page.getByRole("link", { name: place.name, exact: true }) });
  await card.scrollIntoViewIfNeeded();
  await expect.poll(() => attempts).toBe(1);
  await page.clock.fastForward(31_100);
  await expect(
    card.getByRole("img", { name: place.name, exact: true }),
  ).toBeVisible();
  expect(attempts).toBe(2);
});
