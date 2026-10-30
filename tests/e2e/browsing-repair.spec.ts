import { test, expect } from "@playwright/test";
import { PLACES } from "../../src/providers/places";
import { localMapFixture, gpuLaunchOptions } from "./fixtures/map";
test.use({ launchOptions: gpuLaunchOptions });
async function setup(page: import("@playwright/test").Page) {
  await localMapFixture(page);
  const museum = {
    ...PLACES[0],
    id: "browsing-museum",
    name: "Lantern Local Museum",
    aliases: ["Lantern Collection"],
    category: "Museum",
    coordinates: { lat: 51.347, lng: -0.8 },
    hours: undefined,
    image: undefined,
    environment: "indoor",
    daylightOnly: false,
    cost: 0,
    duration: [20, 40],
  };
  await page.route("**/api/places?**", (route) =>
    route.fulfill({ json: { places: [museum], source: "live" } }),
  );
  await page.route("**/api/photo?**", (route) =>
    route.fulfill({ json: { image: null, source: "unavailable" } }),
  );
  await page.route("https://api.open-meteo.com/**", (route) =>
    route.fulfill({ status: 503 }),
  );
}
test("wide map layout stays on screen and a partial name searches the results", async ({
  page,
}) => {
  await page.setViewportSize({ width: 2560, height: 1080 });
  await setup(page);
  await page.goto("/map");
  await page.getByLabel("Search map outings").fill("lantern");
  await page.getByLabel("Search map outings").press("Enter");
  await expect(page.locator(".map-result-row")).toHaveCount(1);
  await expect(page.locator(".map-result-row")).toContainText(
    "Lantern Local Museum",
  );
  await expect(
    page.getByText("Go somewhere good.", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".map-status")).toHaveCount(0);
  expect((await page.locator(".header .brand").boundingBox())!.x).toBeLessThan(
    70,
  );
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollHeight - innerHeight),
    )
    .toBeLessThan(2);
  await page.getByRole("button", { name: "Map layers", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Street" })).toBeVisible();
  await page.getByRole("radio", { name: "Street" }).check();
  await expect(page.locator(".map-result-row")).toHaveCount(1);
});
test("planning controls change time and weather on the main map and return to live", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await setup(page);
  await page.goto("/map");
  await page.getByLabel("Plan time and weather").click();
  await page.getByRole("button", { name: "Tomorrow at 2pm" }).click();
  await page.getByLabel("Planning weather").selectOption("sunny");
  await page.getByRole("button", { name: "Use this plan" }).click();
  await expect(page.locator(".context-weather")).toContainText(
    "Weather preview",
  );
  await expect(page.locator(".weather-atmosphere")).toHaveAttribute(
    "data-weather",
    "sunny",
  );
  await expect(page.locator(".weather-atmosphere")).toHaveAttribute(
    "data-time",
    "midday",
  );
  await page.getByLabel("Plan time and weather").click();
  await page.getByRole("button", { name: "Back to now", exact: true }).click();
  await expect(page.locator(".context-weather")).not.toContainText(
    "Weather preview",
  );
});

test("a broken external image is replaced directly from another host without an image proxy", async ({
  page,
}) => {
  await setup(page);
  const broken = {
    url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Broken.jpg",
    source: "https://commons.wikimedia.org/wiki/File:Broken.jpg",
    credit: "Photographer",
    license: "CC0",
    checkedAt: "2026-10-30",
  };
  const replacement = {
    ...broken,
    url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Replacement.jpg",
    source: "https://commons.wikimedia.org/wiki/File:Replacement.jpg",
  };
  const place = {
    ...PLACES[0],
    id: "external-recovery",
    name: "Recovery Museum",
    coordinates: { lat: 51.347, lng: -0.8 },
    category: "Museum",
    image: broken,
    hours: undefined,
    daylightOnly: false,
    environment: "indoor",
    cost: 0,
  };
  await page.route("**/api/places?**", (route) =>
    route.fulfill({ json: { places: [place], source: "live" } }),
  );
  let excluded = "";
  await page.route("**/api/photo?**", (route) => {
    excluded =
      new URL(route.request().url()).searchParams.get("excludeUrl") ?? "";
    return route.fulfill({ json: { image: replacement } });
  });
  await page.route(broken.url, (route) => route.fulfill({ status: 404 }));
  await page.route(replacement.url, (route) =>
    route.fulfill({
      path: "public/icons/icon-192.png",
      contentType: "image/png",
    }),
  );
  await page.goto("/map?q=Recovery");
  const image = page.locator(".map-result-row img");
  await expect(image).toHaveAttribute("src", replacement.url);
  await expect
    .poll(() =>
      image.evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
      ),
    )
    .toBe(true);
  expect(excluded).toBe(broken.url);
});

test("applying unchanged planning settings retains the loaded forecast", async ({
  page,
}) => {
  await setup(page);
  const now = new Date().toISOString(),
    date = now.slice(0, 10);
  await page.route("https://api.open-meteo.com/**", (route) =>
    route.fulfill({
      json: {
        utc_offset_seconds: 0,
        current: {
          time: now.slice(0, 16),
          temperature_2m: 17,
          precipitation: 0,
          weather_code: 0,
          wind_speed_10m: 8,
        },
        daily: { sunrise: [`${date}T07:00`], sunset: [`${date}T17:00`] },
        hourly: { time: [], visibility: [] },
      },
    }),
  );
  await page.goto("/map");
  await expect(page.locator(".context-weather")).toContainText(
    "Local forecast",
  );
  await page.getByLabel("Plan time and weather").click();
  await page.getByRole("button", { name: "Use this plan" }).click();
  await expect(page.locator(".context-weather")).toContainText("17°");
  await expect(page.locator(".context-weather")).not.toContainText(
    "unavailable",
  );
});

test("mobile map and planning controls fit without a footer gap", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.goto("/map");
  await expect(page.locator("[data-map-status]")).toHaveText("Map ready", {
    timeout: 30000,
  });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollHeight - innerHeight),
    )
    .toBeLessThan(2);
  await page.screenshot({ path: "/tmp/sidequest-map-mobile.png" });
  await page.getByLabel("Plan time and weather").click();
  const panel = page.getByRole("button", { name: "Use this plan" });
  await expect(panel).toBeVisible();
  expect((await panel.boundingBox())!.x).toBeGreaterThanOrEqual(0);
  await page.screenshot({ path: "/tmp/sidequest-plan-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel("Plan time and weather").click();
  await page.screenshot({ path: "/tmp/sidequest-map-desktop.png" });
});
