import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";

// A decoded, labeled raster tile is deterministic here; release screenshots must
// separately verify real provider roads and labels, without route interception.
const geography = sharp(
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e8ecdf"/><path d="M0 100H256M110 0V256" stroke="#fff" stroke-width="15"/><path d="M0 100H256M110 0V256" stroke="#aaa" stroke-width="1"/><text x="15" y="90" font-size="14">Test High Street</text><text x="130" y="180" font-size="15">Test Town</text></svg>`,
  ),
)
  .png()
  .toBuffer();

async function environment(page: Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "sidequest:environment",
      JSON.stringify({
        weather: "sunny",
        time: "midday",
        failures: ["weather"],
      }),
    );
  });
  await page.route("**/api/places?**", (route) =>
    route.fulfill({ json: { places: [], source: "live" } }),
  );
  await page.route("**/api/photo?**", (route) =>
    route.fulfill({ json: { image: null, source: "unavailable" } }),
  );
}

async function rasterTiles(page: Page) {
  const tile = await geography;
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: tile }),
  );
}

test("Leaflet is primary with WebGL available and a successfully loaded empty vector style", async ({
  page,
}) => {
  await environment(page);
  await rasterTiles(page);
  // This is the production regression: MapLibre can load this style successfully
  // without painting any geography. WebGL is deliberately left enabled.
  await page.route("https://tiles.openfreemap.org/styles/positron", (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#e5eadb" },
          },
        ],
      },
    }),
  );
  await page.goto("/map");
  expect(
    await page.evaluate(
      () => !!document.createElement("canvas").getContext("webgl2"),
    ),
  ).toBe(true);
  await expect(page.locator('[data-map-engine="leaflet"]')).toBeVisible();
  await expect(page.locator(".leaflet-tile-loaded")).not.toHaveCount(0);
  await expect
    .poll(() =>
      page
        .locator(".leaflet-tile-loaded")
        .evaluateAll(
          (tiles) =>
            tiles.filter(
              (tile) =>
                tile instanceof HTMLImageElement &&
                tile.complete &&
                tile.naturalWidth === 256,
            ).length,
        ),
    )
    .toBeGreaterThan(0);
  await expect(page.locator(".map-status")).toHaveText(
    /Street map · your next detour/,
  );
  await expect(page.locator(".maplibregl-canvas")).toHaveCount(0);
});

test("missing raster geography is reported unavailable and can be retried", async ({
  page,
}) => {
  await environment(page);
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.abort(),
  );
  await page.goto("/map");
  await expect(page.locator(".map-status")).toHaveText(
    /Location overview · map unavailable/,
  );
  await expect(page.locator(".geographic-fallback")).toBeVisible();
  await expect(page.locator('[data-map-engine="leaflet"]')).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Zoom in", exact: true }),
  ).toBeDisabled();
  await rasterTiles(page);
  await page.getByRole("button", { name: "Retry street map" }).click();
  await expect(page.locator(".map-status")).toHaveText(
    /Street map · your next detour/,
  );
  await expect(page.locator(".geographic-fallback")).toHaveCount(0);
});

test("Lab weather and night preserve decoded geography on desktop and mobile", async ({
  page,
}) => {
  await environment(page);
  await rasterTiles(page);
  await page.goto("/dev/environment");
  const map = page.locator('[data-map-engine="leaflet"]');
  await expect(page.locator(".map-status")).toHaveText(
    /Street map · your next detour/,
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [weather, time] of [
      ["clear", "midday"],
      ["heavy-rain", "midday"],
      ["clear", "midnight"],
    ]) {
      await page.getByLabel("Weather", { exact: true }).selectOption(weather);
      await page.getByLabel("Time of day").selectOption(time);
      await expect(map).toBeVisible();
      await expect(page.locator(".map-status")).toHaveText(
        /Street map · your next detour/,
      );
      await expect(map.locator(".leaflet-tile-loaded").first()).toBeVisible();
      await expect(map).toHaveClass(
        time === "midnight" ? /raster-night/ : /^(?!.*raster-night)/,
      );
    }
  }
});

test("saved and visited map markers expose keyboard selection and distinct state", async ({
  page,
}) => {
  await environment(page);
  await rasterTiles(page);
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
  await page.goto("/map");
  const marker = page.getByRole("button", {
    name: "Select Virginia Water · saved · visited",
    exact: true,
  });
  await expect(marker).toHaveClass(/map-place-visited/);
  await marker.focus();
  await page.keyboard.press("Enter");
  await expect(marker).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".map-selected")).toContainText("Virginia Water");
});

test("search this area preserves the user's panned camera", async ({
  page,
}) => {
  await environment(page);
  await rasterTiles(page);
  await page.goto("/map?place=virginia-water");
  const map = page.locator('[data-map-engine="leaflet"]');
  await expect(page.locator(".map-selected")).toContainText("Virginia Water");
  await expect(page.locator(".map-status")).toHaveText(
    /Street map · your next detour/,
  );
  const pane = page.locator(".leaflet-map-pane");
  const initial = await pane.getAttribute("style");
  await map.focus();
  await map.press("ArrowRight");
  await expect.poll(() => pane.getAttribute("style")).not.toBe(initial);
  await expect(pane).not.toHaveClass(/leaflet-pan-anim/);
  const camera = await pane.getAttribute("style");
  await page
    .getByRole("button", { name: "Search this area", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Change starting location: Map area" }),
  ).toBeVisible();
  await expect(pane).toHaveAttribute("style", camera!);
});
