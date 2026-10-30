import { test, expect } from "@playwright/test";
import { PLACES } from "../../src/providers/places";
import { localMapFixture, gpuLaunchOptions } from "./fixtures/map";
test.use({ launchOptions: gpuLaunchOptions });

test("family browsing shows the whole park and lets people reveal or search its interior places", async ({
  page,
}) => {
  await localMapFixture(page);
  const base = {
    ...PLACES[0],
    coordinates: { lat: 51.347, lng: -0.8 },
    hours: undefined,
    image: undefined,
    daylightOnly: false,
    cost: 0,
    duration: [20, 40],
    suitability: undefined,
    ageRange: undefined,
  };
  const park = {
    ...base,
    id: "overview-park",
    name: "Lantern Adventure Park",
    category: "Theme park",
    bounds: { south: 51.34, north: 51.35, west: -0.81, east: -0.79 },
  };
  const playground = {
    ...base,
    id: "overview-play",
    name: "Lantern Junior Playground",
    category: "Playground",
    ageRange: [0, 12],
  };
  await page.route("**/api/places?**", (route) =>
    route.fulfill({ json: { places: [park, playground], source: "live" } }),
  );
  await page.route("**/api/photo?**", (route) =>
    route.fulfill({ json: { image: null } }),
  );
  await page.route("**/api/venue-evidence?**", (route) =>
    route.fulfill({ json: { status: "disabled", place: null } }),
  );
  await page.route("https://api.open-meteo.com/**", (route) =>
    route.fulfill({ status: 503 }),
  );
  await page.goto("/map");
  await page.getByLabel("Who is coming").selectOption("family");
  await expect(
    page.locator(".map-result-row").filter({ hasText: park.name }),
  ).toBeVisible();
  await expect(
    page.locator(".map-result-row").filter({ hasText: playground.name }),
  ).toHaveCount(0);
  await page.getByLabel("Places inside attractions").check();
  await expect(
    page.locator(".map-result-row").filter({ hasText: playground.name }),
  ).toBeVisible();
  await page.getByLabel("Places inside attractions").uncheck();
  await page.getByLabel("Search map outings").fill("Lantern Junior");
  await page.getByLabel("Search map outings").press("Enter");
  await expect(page.locator(".map-result-row")).toHaveCount(1);
  await expect(page.locator(".map-result-row")).toContainText(playground.name);
});
