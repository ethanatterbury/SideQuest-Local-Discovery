import { test, expect, type Page } from "@playwright/test";
import { mapFixture as fixture, gpuLaunchOptions } from "./fixtures/map";

// Real MapLibre renderer, deterministic local GeoJSON. This verifies rendering
// and interaction, not hosted OpenFreeMap connectivity or factual geography.

test.use({ launchOptions: gpuLaunchOptions });

async function environment(page: Page, empty = false) {
  page.on("pageerror", (error) =>
    console.error("Browser error:", error.message),
  );
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname))
      return route.fulfill({
        status: 503,
        body: "External services intentionally disabled by renderer fixture",
      });
    if (
      url.pathname === "/_next/image" &&
      /^https?:/.test(url.searchParams.get("url") ?? "")
    )
      return route.fulfill({
        status: 503,
        body: "Remote photography disabled in renderer tests",
      });
    if (url.pathname === "/api/places")
      return route.fulfill({ json: { places: [], source: "cached" } });
    if (url.pathname === "/api/photo")
      return route.fulfill({ json: { image: null, source: "unavailable" } });
    return route.continue();
  });
  await page.addInitScript(
    ({ style, empty }) => {
      (
        window as Window & { __SIDEQUEST_MAP_STYLE__?: unknown }
      ).__SIDEQUEST_MAP_STYLE__ = empty
        ? {
            version: 8,
            sources: {},
            layers: [
              {
                id: "background",
                type: "background",
                paint: { "background-color": "#f5f3eb" },
              },
            ],
          }
        : style;
      sessionStorage.setItem(
        "sidequest:environment",
        JSON.stringify({
          weather: "sunny",
          time: "midday",
          reducedMotion: true,
        }),
      );
    },
    { style: fixture, empty },
  );
}

async function ready(page: Page) {
  await expect(
    page.locator('[data-map-engine="maplibre"] .maplibregl-canvas'),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".map-status")).toHaveText(
    /Landscape map · your next detour/,
    { timeout: 15000 },
  );
}

test("MapLibre renders local geography and style load alone fails with a recoverable retry", async ({
  page,
}) => {
  await environment(page, true);
  await page.goto("/map");
  await expect(page.locator(".maplibregl-canvas")).toBeVisible({
    timeout: 15000,
  });
  await expect(page.locator(".map-status")).toHaveText(
    /Location overview · map unavailable/,
    { timeout: 14000 },
  );
  await expect(page.locator(".geographic-fallback")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Zoom in", exact: true }),
  ).toBeDisabled();
  await page.evaluate((style) => {
    (
      window as Window & { __SIDEQUEST_MAP_STYLE__?: unknown }
    ).__SIDEQUEST_MAP_STYLE__ = style;
  }, fixture);
  await page.getByRole("button", { name: "Retry street map" }).click();
  await ready(page);
  await expect(page.locator(".geographic-fallback")).toHaveCount(0);
  await expect(page.locator(".leaflet-container")).toHaveCount(0);
});

test("saved and visited native markers support keyboard selection", async ({
  page,
}) => {
  await environment(page);
  await page.addInitScript(() =>
    localStorage.setItem(
      "sidequest:v1",
      JSON.stringify({
        version: 1,
        saved: ["virginia-water"],
        visits: [
          {
            id: "virginia-water",
            date: "2026-10-08T10:00:00Z",
            reaction: "Loved it",
            note: "",
            km: 2,
          },
        ],
      }),
    ),
  );
  await page.goto("/map?place=virginia-water");
  await ready(page);
  const marker = page.getByRole("button", {
    name: "Select Virginia Water, saved, visited",
    exact: true,
  });
  await expect(marker).toBeVisible();
  await expect(marker.locator("svg")).toHaveCount(2);
  await marker.evaluate((button) =>
    button.addEventListener(
      "click",
      () => button.setAttribute("data-keyboard-activated", "true"),
      { once: true },
    ),
  );
  await marker.focus();
  await page.keyboard.press("Enter");
  await expect(marker).toHaveAttribute("data-keyboard-activated", "true");
  await expect(marker).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".map-selected")).toContainText("Virginia Water");
});

test("keyboard panning exposes search area and preserves the user's camera", async ({
  page,
}) => {
  await environment(page);
  await page.goto("/map?place=virginia-water");
  await ready(page);
  await page.evaluate(() => {
    document
      .querySelector(".map-canvas-wrap")!
      .addEventListener("sq-camera", (event) => {
        const detail = (event as CustomEvent).detail;
        (
          window as Window & { testCamera?: { x: number; y: number } }
        ).testCamera = { x: detail.x, y: detail.y };
      });
  });
  const canvas = page.locator(".maplibregl-canvas");
  await canvas.focus();
  await canvas.press("ArrowRight");
  await expect(
    page.getByRole("button", { name: "Search this area", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { testCamera?: unknown }).testCamera,
      ),
    )
    .toBeTruthy();
  const before = await page.evaluate(
    () =>
      (window as Window & { testCamera?: { x: number; y: number } })
        .testCamera!,
  );
  await page
    .getByRole("button", { name: "Search this area", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Change starting location: Map area" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Search this area", exact: true }),
  ).toHaveCount(0);
  const after = await page.evaluate(
    () =>
      (window as Window & { testCamera?: { x: number; y: number } })
        .testCamera!,
  );
  expect(after.x).toBeCloseTo(before.x, 6);
  expect(after.y).toBeCloseTo(before.y, 6);
});
