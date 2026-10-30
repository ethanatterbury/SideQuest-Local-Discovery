import { test, expect } from "@playwright/test";
import sharp from "sharp";
import {
  localMapFixture,
  gpuLaunchOptions,
  observeCamera,
  cameraPosition,
} from "./fixtures/map";
test.use({ launchOptions: gpuLaunchOptions });
async function data(page: import("@playwright/test").Page) {
  await page.route("**/api/places?**", (route) =>
    route.fulfill({ json: { places: [], source: "live" } }),
  );
  await page.route("**/api/photo?**", (route) =>
    route.fulfill({ json: { image: null } }),
  );
  await page.route("https://api.open-meteo.com/**", (route) =>
    route.fulfill({ status: 503 }),
  );
}
test("switching layers and returning from another tab keeps the default geography usable", async ({
  page,
}) => {
  await localMapFixture(page);
  await data(page);
  const tile = await sharp({
    create: { width: 256, height: 256, channels: 3, background: "#58714d" },
  })
    .jpeg()
    .toBuffer();
  await page.route("https://tiles.maps.eox.at/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ contentType: "image/jpeg", body: tile });
  });
  await page.goto("/map");
  await expect(page.locator("[data-map-status]")).toHaveText("Map ready", {
    timeout: 30000,
  });
  await observeCamera(page);
  await page.locator(".maplibregl-canvas").focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(500);
  const before = await cameraPosition(page);
  await page.getByRole("button", { name: "Map layers" }).click();
  await expect(page.getByRole("radio", { name: "Street" })).toHaveCount(0);
  await page.getByRole("radio", { name: "Satellite" }).check();
  await page.getByRole("radio", { name: "Default" }).check();
  const tab = await page.context().newPage();
  await tab.bringToFront();
  await page.bringToFront();
  await tab.close();
  await expect(page.locator(".geographic-fallback")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Zoom in", exact: true }),
  ).toBeEnabled();
  expect((await cameraPosition(page)).x).toBeCloseTo(before.x, 7);
});
test("a failed vector style automatically loads independent geographic raster tiles", async ({
  page,
}) => {
  await data(page);
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.fulfill({ status: 503 }),
  );
  const tile = await sharp({
    create: { width: 256, height: 256, channels: 3, background: "#d9e1c7" },
  })
    .png()
    .toBuffer();
  let tiles = 0;
  await page.route("https://tile.openstreetmap.org/**", (route) => {
    tiles++;
    return route.fulfill({ contentType: "image/png", body: tile });
  });
  await page.goto("/map");
  await expect(page.locator("[data-map-status]")).toHaveText("Map ready", {
    timeout: 30000,
  });
  expect(tiles).toBeGreaterThan(0);
  await expect(page.locator(".geographic-fallback")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Zoom in", exact: true }),
  ).toBeEnabled();
});
test("native graphics context restoration retains markers and the panned camera", async ({
  page,
}) => {
  await localMapFixture(page);
  await data(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/map");
  await expect(page.locator("[data-map-status]")).toHaveText("Map ready", {
    timeout: 30000,
  });
  await observeCamera(page);
  await page.locator(".maplibregl-canvas").focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(500);
  const before = await cameraPosition(page);
  await page.locator(".maplibregl-canvas").evaluate((canvas) => {
    const gl = (canvas as HTMLCanvasElement).getContext("webgl2");
    const extension = gl?.getExtension("WEBGL_lose_context");
    if (!extension)
      throw Error("Context-loss extension unavailable in renderer fixture");
    extension.loseContext();
    setTimeout(() => extension.restoreContext(), 250);
  });
  await expect(page.locator("[data-map-status]")).toHaveText("Map ready", {
    timeout: 30000,
  });
  await expect(page.locator(".maplibregl-marker").first()).toBeAttached();
  expect((await cameraPosition(page)).x).toBeCloseTo(before.x, 7);
  expect(errors).toEqual([]);
});
