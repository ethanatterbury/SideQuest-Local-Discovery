import { test, expect, type Page } from "@playwright/test";
import {
  localMapFixture,
  gpuLaunchOptions,
  observeCamera,
  cameraPosition,
} from "./fixtures/map";
import type { Place } from "../../src/domain/models";

test.use({ launchOptions: gpuLaunchOptions });
test.setTimeout(90000);
const places: Place[] = Array.from({ length: 8 }, (_, i) => ({
  id: `osm-node-${990000 + i}`,
  name: `Stability Museum ${i}`,
  area: "Camberley",
  coordinates: { lat: 51.337 + i * 0.001, lng: -0.745 + i * 0.001 },
  category: "Museum",
  description: "A local museum",
  tagline: "A local museum",
  environment: "indoor",
  intents: ["culture", "kids"],
  company: ["solo", "couple", "friends", "family"],
  duration: [30, 60],
  cost: null,
  costLabel: "Check admission",
  novelty: 0.8,
  daylightOnly: false,
  notes: [],
  source: `https://www.openstreetmap.org/node/${990000 + i}`,
  website: "https://example.com",
}));

async function assertProjectedMarkers(page: Page) {
  await expect(
    page.locator('button[aria-label^="Select Stability"]').first(),
  ).toBeAttached();
  const camera = await cameraPosition(page);
  const bounds = (await page.locator(".maplibregl-canvas").boundingBox())!;
  for (const place of places) {
    const marker = page.getByRole("button", {
      name: `Select ${place.name}`,
      exact: true,
    });
    if (!(await marker.count())) continue;
    const box = (await marker.boundingBox())!;
    const x = (place.coordinates.lng + 180) / 360;
    const y =
      (1 -
        Math.log(
          Math.tan(Math.PI / 4 + (place.coordinates.lat * Math.PI) / 360),
        ) /
          Math.PI) /
      2;
    expect(
      Math.abs(
        box.x +
          box.width / 2 -
          (bounds.x + bounds.width / 2 + (x - camera.x) * camera.scale),
      ),
      place.name + " projected x",
    ).toBeLessThan(1.1);
    expect(
      Math.abs(
        box.y +
          box.height / 2 -
          (bounds.y + bounds.height / 2 + (y - camera.y) * camera.scale),
      ),
      place.name + " projected y",
    ).toBeLessThan(1.1);
  }
}

test("place buttons stay anchored to geography after cluster expansion, zoom and pan", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await localMapFixture(page);
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "sidequest:environment",
      JSON.stringify({
        weather: "sunny",
        time: "midday",
        reducedMotion: true,
        failures: ["weather"],
      }),
    );
    document.addEventListener("DOMContentLoaded", () => {
      document.addEventListener(
        "sq-camera",
        (event) => {
          (window as Window & { testCamera?: unknown }).testCamera = (
            event as CustomEvent
          ).detail;
        },
        true,
      );
    });
  });
  await page.route("**/data/venues/manifest.json", (route) =>
    route.fulfill({ json: { cells: {} } }),
  );
  await page.route("**/api/places?**", (route) =>
    route.fulfill({ json: { places, source: "live" } }),
  );
  await page.route("**/api/photo?**", (route) =>
    route.fulfill({ json: { image: null, source: "unavailable" } }),
  );
  await page.goto("/map?q=Stability%20Museum");
  await expect(page.locator("[data-map-status]")).toContainText("Map ready", {
    timeout: 30000,
  });
  await observeCamera(page);
  const cluster = page.getByRole("button", {
    name: "Zoom in to 8 places",
    exact: true,
  });
  await expect(cluster).toBeVisible();
  await expect(cluster).toHaveClass(/maplibregl-marker/);
  await assertProjectedMarkers(page);
  // The initial auto-selected place overlaps this dense cluster. Expansion must
  // remain pointer accessible without clearing the selection first.
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await page.waitForTimeout(350);
  await expect(cluster).toHaveClass(/maplibregl-marker/);
  await cluster.click();
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await page.waitForTimeout(350);
  }
  await expect(
    page.locator('button[aria-label^="Select Stability"]'),
  ).toHaveCount(8);
  await assertProjectedMarkers(page);
  await page.locator(".maplibregl-canvas").focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(700);
  await assertProjectedMarkers(page);
  const marker = page.getByRole("button", {
    name: "Select Stability Museum 7",
    exact: true,
  });
  await marker.click();
  await expect(page.locator(".map-selected h2")).toHaveText(
    "Stability Museum 7",
  );
  await page.waitForTimeout(350);
  await assertProjectedMarkers(page);
});
