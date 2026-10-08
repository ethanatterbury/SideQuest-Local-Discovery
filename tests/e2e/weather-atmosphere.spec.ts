import { expect, test, type Locator, type Page } from "@playwright/test";
import sharp from "sharp";

// Real map screenshots are a separate release check. These decoded fixture
// tiles exercise the actual Leaflet stack without depending on provider uptime.
const tile = sharp(
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e8ecdf"/><path d="M0 100H256M110 0V256" stroke="#fff" stroke-width="15"/><path d="M0 100H256M110 0V256" stroke="#aaa" stroke-width="1"/><text x="15" y="90" font-size="14">High Street</text><text x="130" y="180" font-size="15">Town centre</text></svg>',
  ),
)
  .png()
  .toBuffer();

async function lab(page: Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "sidequest:environment",
      JSON.stringify({
        weather: "overcast",
        time: "midday",
        failures: ["weather"],
      }),
    );
  });
  await page.route("https://tile.openstreetmap.org/**", async (route) =>
    route.fulfill({ contentType: "image/png", body: await tile }),
  );
  await page.route("**/api/places?**", (route) =>
    route.fulfill({ json: { places: [], source: "live" } }),
  );
  await page.route("**/api/photo?**", (route) =>
    route.fulfill({ json: { image: null, source: "unavailable" } }),
  );
  await page.goto("/dev/environment");
  await expect(page.locator(".map-status")).toContainText("Street map");
  await expect(page.locator(".leaflet-tile-loaded").first()).toBeVisible();
}

async function expectMoving(layer: Locator) {
  const transform = await layer.evaluate(
    (element) => getComputedStyle(element).transform,
  );
  await expect
    .poll(() =>
      layer.evaluate((element) => getComputedStyle(element).transform),
    )
    .not.toBe(transform);
}

// Compare exactly the same decoded geography, at the same animation instant.
// This catches layers hidden underneath tiles and CSS with imperceptible opacity.
async function visibleWeatherPixels(page: Page, layer: string) {
  await expect(page.locator(".map-status")).toHaveText(
    "Street map · your next detour",
  );
  await page.evaluate(() => document.fonts.ready);
  // Leaflet adds new tiles after a responsive resize. Give the pane one layout
  // frame, then require all visible tiles to be decoded before pixel comparison.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect
    .poll(() =>
      page
        .locator(".leaflet-tile")
        .evaluateAll((tiles) =>
          tiles.every(
            (tile) =>
              tile instanceof HTMLImageElement &&
              tile.complete &&
              tile.naturalWidth > 0,
          ),
        ),
    )
    .toBe(true);
  const map = page.locator(".map-canvas-wrap");
  await map.scrollIntoViewIfNeeded();
  const freeze = await page.addStyleTag({
    content:
      "*, *::before, *::after { animation-play-state: paused !important; transition: none !important; } .leaflet-tile { opacity: 1 !important; }",
  });
  // Scrolling a Lab preview into view can trigger Leaflet's camera correction.
  // Settle that first screenshot before comparing the weather-only pair.
  await map.screenshot();
  const withWeather = await map.screenshot();
  await page
    .locator(layer)
    .evaluateAll((elements) =>
      elements.forEach(
        (element) => ((element as HTMLElement).style.visibility = "hidden"),
      ),
    );
  const withoutWeather = await map.screenshot();
  await page
    .locator(layer)
    .evaluateAll((elements) =>
      elements.forEach(
        (element) => ((element as HTMLElement).style.visibility = ""),
      ),
    );
  await freeze.evaluate((element) => element.parentNode?.removeChild(element));
  const a = await sharp(withWeather).removeAlpha().raw().toBuffer();
  const b = await sharp(withoutWeather).removeAlpha().raw().toBuffer();
  let changed = 0;
  let maximum = 0;
  for (let i = 0; i < a.length; i += 3) {
    const difference = Math.max(
      Math.abs(a[i] - b[i]),
      Math.abs(a[i + 1] - b[i + 1]),
      Math.abs(a[i + 2] - b[i + 2]),
    );
    if (difference >= 3) changed++;
    maximum = Math.max(maximum, difference);
  }
  return { changed, maximum, total: a.length / 3 };
}

test("Lab weather selection clears unavailable state and paints moving rain above decoded streets", async ({
  page,
}) => {
  await lab(page);
  await expect(
    page.getByLabel("Weather unavailable", { exact: true }),
  ).toBeChecked();
  await expect(page.locator(".weather-atmosphere")).toHaveClass(/unavailable/);
  await page.getByLabel("Weather", { exact: true }).selectOption("heavy-rain");
  await expect(
    page.getByLabel("Weather unavailable", { exact: true }),
  ).not.toBeChecked();
  await expect(page.locator(".weather-particles i")).toHaveCount(24);
  await expectMoving(page.locator(".weather-particles i").first());
  await expect(page.locator(".weather-atmosphere")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(page.locator(".weather-atmosphere")).toHaveCSS(
    "pointer-events",
    "none",
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const rain = await visibleWeatherPixels(
      page,
      ".weather-particles, .rain-ripples",
    );
    expect(rain.changed).toBeGreaterThan(50);
    expect(rain.changed / rain.total).toBeLessThan(0.02);
    const marker = page
      .locator('.map-place-marker[aria-pressed="true"]')
      .first();
    await expect(marker).toBeVisible();
    await marker.scrollIntoViewIfNeeded();
    expect(
      await marker.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        );
        return hit === element || element.contains(hit);
      }),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "Zoom in", exact: true }),
    ).toBeEnabled();
  }
});

test("overcast has soft moving cloud shadows on desktop and mobile with readable geography", async ({
  page,
}) => {
  await lab(page);
  await page.getByLabel("Weather", { exact: true }).selectOption("overcast");
  await expect(page.locator(".cloud-shadow")).toHaveCount(2);
  await expectMoving(page.locator(".cloud-shadow-near"));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const clouds = await visibleWeatherPixels(page, ".cloud-shadows");
    expect(clouds.changed / clouds.total).toBeGreaterThan(0.15);
    // The darkest cloud shadow remains a gentle tint on the street labels.
    expect(clouds.maximum).toBeLessThan(60);
    await expect(page.locator(".leaflet-tile-loaded").first()).toBeVisible();
    await expect(page.locator(".map-status")).toContainText("Street map");
  }
});

test("reduced motion keeps static atmosphere and hidden tabs stop weather work", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await lab(page);
  await page.getByLabel("Weather", { exact: true }).selectOption("heavy-rain");
  await expect(page.locator(".weather-particles i")).toHaveCount(0);
  await expect(page.locator(".rain-ripples i")).toHaveCount(0);
  await expect(page.locator(".cloud-shadow-near")).toHaveCSS(
    "animation-name",
    "none",
  );
  const clouds = await visibleWeatherPixels(page, ".cloud-shadows");
  expect(clouds.changed).toBeGreaterThan(100);
  // An explicit preview choice is the effective preference, including Normal
  // on a device whose system setting requests reduced motion.
  await page.getByLabel("Motion", { exact: true }).selectOption("normal");
  await expect(page.locator(".weather-particles")).toBeVisible();
  await expectMoving(page.locator(".weather-particles i").first());
  await expectMoving(page.locator(".cloud-shadow-near"));
  await page.getByLabel("Motion", { exact: true }).selectOption("reduced");
  await expect(page.locator(".weather-particles i")).toHaveCount(0);
  await expect(page.locator(".cloud-shadow-near")).toHaveCSS(
    "animation-name",
    "none",
  );
  await page.getByLabel("Motion", { exact: true }).selectOption("system");
  await expect(page.locator(".weather-particles i")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator(".weather-particles i")).toHaveCount(24);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator(".weather-atmosphere")).toHaveClass(/paused/);
  await expect(page.locator(".weather-particles i")).toHaveCount(0);
  await expect(page.locator(".cloud-shadow-near")).toHaveCSS(
    "animation-play-state",
    "paused",
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator(".weather-particles i")).toHaveCount(24);
  await expectMoving(page.locator(".cloud-shadow-near"));
});
