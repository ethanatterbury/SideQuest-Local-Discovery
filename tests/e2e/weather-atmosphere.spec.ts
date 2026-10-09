import { expect, test, type Page } from "@playwright/test";
import { mapFixture as fixture, gpuLaunchOptions } from "./fixtures/map";

// Actual GPU execution over a local GeoJSON fixture; no hosted geography claim.
test.use({ launchOptions: gpuLaunchOptions });
async function lab(page: Page) {
  page.on("pageerror", (error) =>
    console.error("Browser error:", error.message),
  );
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname))
      return route.fulfill({
        status: 503,
        body: "External providers intentionally disabled",
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
  await page.addInitScript((style) => {
    (
      window as Window & { __SIDEQUEST_MAP_STYLE__?: unknown }
    ).__SIDEQUEST_MAP_STYLE__ = style;
    sessionStorage.setItem(
      "sidequest:environment",
      JSON.stringify({
        weather: "overcast",
        time: "midday",
        failures: ["weather"],
      }),
    );
  }, fixture);
  await page.goto("/dev/environment");
  await expect(page.locator(".map-status")).toHaveText(
    /Landscape map · your next detour/,
    { timeout: 15000 },
  );
  await expect(page.locator(".weather-atmosphere")).toHaveAttribute(
    "data-renderer",
    "webgl",
  );
}
async function pixels(page: Page) {
  return page.locator(".weather-atmosphere canvas").screenshot();
}
async function settled(page: Page) {
  // The static preview refreshes at 350ms. Wait two frames of that bounded timer.
  await page.waitForTimeout(750);
}

test("Lab weather updates actual GPU pixels on desktop and mobile without recreating geography", async ({
  page,
}) => {
  await lab(page);
  await expect(page.locator(".weather-atmosphere")).toHaveAttribute(
    "data-weather",
    "unavailable",
  );
  await page
    .locator(".maplibregl-canvas")
    .evaluate((element) =>
      element.setAttribute("data-test-identity", "original"),
    );
  await page.getByLabel("Motion", { exact: true }).selectOption("reduced");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByLabel("Weather", { exact: true }).selectOption("clear");
    await page
      .getByLabel("Time of day", { exact: true })
      .selectOption("midday");
    await settled(page);
    const clear = await pixels(page);
    for (const [weather, time] of [
      ["heavy-rain", "midday"],
      ["snow", "evening"],
      ["thunderstorm", "midnight"],
    ]) {
      await page.getByLabel("Weather", { exact: true }).selectOption(weather);
      await page.getByLabel("Time of day", { exact: true }).selectOption(time);
      await expect(
        page.getByLabel("Weather unavailable", { exact: true }),
      ).not.toBeChecked();
      await expect(page.locator(".weather-atmosphere")).toHaveAttribute(
        "data-weather",
        weather,
      );
      await settled(page);
      expect(
        (await pixels(page)).equals(clear),
        `${weather} contributes visible GPU pixels at ${width}px`,
      ).toBe(false);
      await expect(page.locator(".maplibregl-canvas")).toHaveAttribute(
        "data-test-identity",
        "original",
      );
      await expect(
        page.getByRole("button", { name: "Zoom in", exact: true }),
      ).toBeEnabled();
    }
  }
  await expect(page.locator(".weather-atmosphere")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(page.locator(".weather-atmosphere")).toHaveCSS(
    "pointer-events",
    "none",
  );
  await expect(page.locator(".weather-particles i")).toHaveCount(0);
});

test("reduced motion and hidden tabs stop GPU animation; Normal resumes it", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await lab(page);
  await page.getByLabel("Weather", { exact: true }).selectOption("heavy-rain");
  await expect(page.locator(".weather-atmosphere")).toHaveAttribute(
    "data-motion",
    "reduced",
  );
  await settled(page);
  const staticFrame = await pixels(page);
  await settled(page);
  expect((await pixels(page)).equals(staticFrame)).toBe(true);
  await page.getByLabel("Motion", { exact: true }).selectOption("normal");
  await expect(page.locator(".weather-atmosphere")).toHaveAttribute(
    "data-motion",
    "normal",
  );
  await settled(page);
  const movingFrame = await pixels(page);
  await settled(page);
  expect((await pixels(page)).equals(movingFrame)).toBe(false);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await settled(page);
  const pausedFrame = await pixels(page);
  await settled(page);
  expect((await pixels(page)).equals(pausedFrame)).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await settled(page);
  expect((await pixels(page)).equals(pausedFrame)).toBe(false);
  await page
    .getByLabel("Weather", { exact: true })
    .selectOption("thunderstorm");
  await expect(page.getByLabel("Rain intensity", { exact: true })).toHaveValue(
    "12",
  );
  await expect(page.getByLabel("Wind", { exact: true })).toHaveValue("48");
  await page.getByLabel("Motion", { exact: true }).selectOption("reduced");
  await settled(page);
  const staticStorm = await pixels(page);
  await settled(page);
  expect((await pixels(page)).equals(staticStorm)).toBe(true);
});
