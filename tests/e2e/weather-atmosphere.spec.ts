import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { mapFixture as fixture, gpuLaunchOptions } from "./fixtures/map";

// Actual GPU execution over a local GeoJSON fixture; no hosted geography claim.
test.use({ launchOptions: gpuLaunchOptions });
// Software WebGL runs several full-size GPU captures per case on CI.
test.describe.configure({ timeout: 240000 });
async function lab(page: Page) {
  page.on("pageerror", (error) =>
    console.error("Browser error:", error.message),
  );
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (
      url.hostname === "tiles.openfreemap.org" &&
      url.pathname.includes("/styles/")
    )
      return route.fulfill({ json: fixture });
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
        atmosphereQuality: "low",
        reducedMotion: true,
      }),
    );
  }, fixture);
  await page.goto("/dev/environment");
  await expect(page.locator(".map-status")).toHaveText(
    /Landscape map · your next detour/,
    { timeout: 60000 },
  );
  await expect(page.locator(".weather-atmosphere")).toHaveAttribute(
    "data-renderer",
    "webgl",
  );
  // Isolate GPU pixels from changing map tiles, marker cards and photographs.
  // Element screenshots otherwise composite these through the transparent canvas.
  await page.addStyleTag({
    content:
      ".weather-atmosphere { background: #829381; z-index: 999 !important; }",
  });
}
async function pixels(page: Page) {
  // Element screenshots already scroll into view when necessary.
  return page.locator(".weather-atmosphere canvas").screenshot();
}
async function samePixels(first: Buffer, second: Buffer) {
  const [a, b] = await Promise.all([
    sharp(first).raw().toBuffer({ resolveWithObject: true }),
    sharp(second).raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (a.info.width !== b.info.width || a.info.height !== b.info.height)
    return false;
  // Compositor rounding can change a channel by 1/255 even with zero GPU draws.
  return a.data.every((value, index) => Math.abs(value - b.data[index]) <= 1);
}
async function select(page: Page, name: string, value: string) {
  // Native selectOption does not need pointer geometry. Avoid an additional
  // smooth-scroll/stability wait through software-rendered map frames.
  const control = page.getByLabel(name, { exact: true });
  if ((page.viewportSize()?.width ?? 1280) < 700) {
    // These are renderer fixtures, not Lab control hit-target checks. The narrow
    // Lab clips its scrollable controls; dispatch the native selection directly.
    await expect(control).toBeEnabled();
    await control.selectOption(value, { force: true });
  } else await control.selectOption(value);
}
async function settled(page: Page) {
  // Let the event-driven GPU draw and browser compositing settle.
  await page.waitForTimeout(750);
}

test("cloud density is independent of map panning and zooming", async ({
  page,
}) => {
  await lab(page);
  await select(page, "Weather", "overcast");
  await select(page, "Motion", "reduced");
  await settled(page);
  const before = await pixels(page);
  await page.evaluate(() => {
    document.querySelector(".map-canvas-wrap")!.dispatchEvent(
      new CustomEvent("sq-camera", {
        detail: {
          x: 0.7,
          y: 0.3,
          scale: 512 * 32,
          width: 1000,
          height: 700,
          water: [],
        },
      }),
    );
  });
  await settled(page);
  expect(await samePixels(await pixels(page), before)).toBe(true);
});

for (const width of [1440, 390]) {
  test(`Lab weather updates actual GPU pixels at ${width}px without recreating geography`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
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
    await select(page, "Motion", "reduced");
    // Resize the same map once; each viewport owns its own GPU-test budget.
    await page.setViewportSize({ width: width - 20, height: 900 });
    await page.setViewportSize({ width, height: 900 });
    await select(page, "Weather", "clear");
    await select(page, "Time of day", "midday");
    await settled(page);
    const clear = await pixels(page);
    for (const [weather, time] of [
      ["heavy-rain", "midday"],
      ["snow", "evening"],
      ["thunderstorm", "midnight"],
    ]) {
      await select(page, "Weather", weather);
      await select(page, "Time of day", time);
      await expect(
        page.getByLabel("Weather unavailable", { exact: true }),
      ).not.toBeChecked();
      await expect(page.locator(".weather-atmosphere")).toHaveAttribute(
        "data-weather",
        weather,
      );
      await settled(page);
      expect(
        await samePixels(await pixels(page), clear),
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
}

test("reduced motion and hidden tabs stop GPU animation; Normal resumes it", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await lab(page);
  await select(page, "Weather", "heavy-rain");
  await expect(page.locator(".weather-atmosphere")).toHaveAttribute(
    "data-motion",
    "reduced",
  );
  await settled(page);
  const staticFrame = await pixels(page);
  await settled(page);
  expect(await samePixels(await pixels(page), staticFrame)).toBe(true);
  await select(page, "Motion", "normal");
  await expect(page.locator(".weather-atmosphere")).toHaveAttribute(
    "data-motion",
    "normal",
  );
  await settled(page);
  const movingFrame = await pixels(page);
  await settled(page);
  expect(await samePixels(await pixels(page), movingFrame)).toBe(false);
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
  expect(await samePixels(await pixels(page), pausedFrame)).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await settled(page);
  expect(await samePixels(await pixels(page), pausedFrame)).toBe(false);
  await select(page, "Weather", "thunderstorm");
  await expect(page.getByLabel("Rain intensity", { exact: true })).toHaveValue(
    "12",
  );
  await expect(page.getByLabel("Wind", { exact: true })).toHaveValue("48");
  await select(page, "Motion", "reduced");
  await settled(page);
  const staticStorm = await pixels(page);
  await settled(page);
  expect(await samePixels(await pixels(page), staticStorm)).toBe(true);
});
