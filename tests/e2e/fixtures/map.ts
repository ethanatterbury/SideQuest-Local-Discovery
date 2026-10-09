import { expect, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
export const mapFixture = {
  version: 8,
  name: "DETERMINISTIC RENDERER FIXTURE — NOT LIVE GEOGRAPHY",
  sources: {
    fixture: {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { kind: "park" },
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [-2, 50],
                  [1, 50],
                  [1, 53],
                  [-2, 53],
                  [-2, 50],
                ],
              ],
            },
          },
          {
            type: "Feature",
            properties: { kind: "water" },
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [-0.88, 51.3],
                  [-0.74, 51.3],
                  [-0.74, 51.4],
                  [-0.88, 51.4],
                  [-0.88, 51.3],
                ],
              ],
            },
          },
          {
            type: "Feature",
            properties: { kind: "road" },
            geometry: {
              type: "LineString",
              coordinates: [
                [-1, 51.3],
                [0, 51.45],
              ],
            },
          },
        ],
      },
    },
  },
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#f5f3eb" },
    },
    {
      id: "forest",
      type: "fill",
      source: "fixture",
      filter: ["==", ["get", "kind"], "park"],
      paint: { "fill-color": "#d9e1c7" },
    },
    {
      id: "water",
      type: "fill",
      source: "fixture",
      filter: ["==", ["get", "kind"], "water"],
      paint: { "fill-color": "#b7cbd0" },
    },
    {
      id: "road",
      type: "line",
      source: "fixture",
      filter: ["==", ["get", "kind"], "road"],
      paint: { "line-color": "#fff", "line-width": 5 },
    },
  ],
};

export const gpuLaunchOptions = {
  executablePath:
    process.env.CHROMIUM_PATH ||
    (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
  ],
};
export async function localMapFixture(page: Page) {
  await page.addInitScript((style) => {
    (
      window as Window & { __SIDEQUEST_MAP_STYLE__?: unknown }
    ).__SIDEQUEST_MAP_STYLE__ = style;
  }, mapFixture);
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.fulfill({
      status: 503,
      body: "Local renderer fixture; hosted map disabled",
    }),
  );
}
export async function observeCamera(page: Page) {
  await page.evaluate(() => {
    document
      .querySelector(".map-canvas-wrap")!
      .addEventListener("sq-camera", (event) => {
        const detail = (event as CustomEvent).detail;
        (
          window as Window & {
            testCamera?: { x: number; y: number; scale: number };
          }
        ).testCamera = { x: detail.x, y: detail.y, scale: detail.scale };
      });
  });
}
export async function cameraPosition(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { testCamera?: unknown }).testCamera,
      ),
    )
    .toBeTruthy();
  return page.evaluate(
    () =>
      (
        window as Window & {
          testCamera?: { x: number; y: number; scale: number };
        }
      ).testCamera!,
  );
}
