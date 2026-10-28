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

test("a venue website preview loads on its card with source credit and a detail source link", async ({
  page,
}) => {
  const place = {
    ...PLACES[0],
    id: "osm-way-987654321",
    name: "Little Lantern Play",
    area: "Fleet",
    category: "Soft play",
    optionalCategory: undefined,
    environment: "indoor",
    daylightOnly: false,
    coordinates: { lat: 51.347, lng: -0.8 },
    image: undefined,
  };
  const source = "https://littlelantern.co.uk/fleet/";
  const image = {
    url: "https://littlelantern.co.uk/fleet-interior.jpg",
    source,
    credit: place.name,
    license: "Website preview — rights reserved",
    rights: "website-preview",
    strategy: "official-website-preview",
    checkedAt: new Date().toISOString(),
    preview: {
      pageUrl: source,
      publisher: place.name,
      kind: "venue-image",
      identityEvidence: ["venue name and location matched"],
      subjectEvidence: ["physical venue scene in image metadata"],
    },
  };
  await page.route("**/data/venues/manifest.json", (route) =>
    route.fulfill({ json: { cells: {} } }),
  );
  await page.route("**/api/places?**", (route) =>
    route.fulfill({ json: { places: [place], source: "live" } }),
  );
  await page.route("**/api/photo?**", (route) =>
    route.fulfill({
      json: {
        image:
          new URL(route.request().url()).searchParams.get("id") === place.id
            ? image
            : null,
      },
    }),
  );
  await page.route(image.url, (route) =>
    route.fulfill({
      contentType: "image/png",
      body: readFileSync("public/icons/icon-192.png"),
    }),
  );
  await page.goto("/explore");
  await page.getByLabel("Who is coming").selectOption("family");
  const card = page
    .locator(".results-grid > article")
    .filter({ has: page.getByRole("link", { name: place.name, exact: true }) });
  await card.scrollIntoViewIfNeeded();
  const photo = card.getByRole("img", { name: place.name, exact: true });
  await expect(photo).toBeVisible();
  await expect
    .poll(() =>
      photo.evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
      ),
    )
    .toBe(true);
  await expect(
    card.getByText(`From ${place.name}`, { exact: true }),
  ).toBeVisible();
  await card.getByRole("link", { name: place.name, exact: true }).click();
  await expect(page.locator(".image-credit a").first()).toHaveAttribute(
    "href",
    source,
  );
  await expect(page.locator(".image-credit")).toContainText("Website preview");
});
