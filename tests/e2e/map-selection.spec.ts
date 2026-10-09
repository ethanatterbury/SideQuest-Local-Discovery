import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import {
  localMapFixture,
  gpuLaunchOptions,
  observeCamera,
  cameraPosition,
} from "./fixtures/map";
import type { Place } from "../../src/domain/models";

test.use({ launchOptions: gpuLaunchOptions });
const venue: Place = {
  id: "osm-node-980001",
  name: "Selection Museum",
  area: "Camberley",
  coordinates: { lat: 51.337, lng: -0.745 },
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
  website: "https://example.com",
  source: "https://www.openstreetmap.org/node/980001",
  notes: [],
};
const fixtureImage = sharp(
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#9dbaa9"/><path d="M0 280L120 80L270 230L430 120L600 280V400H0Z" fill="#526947"/><text x="35" y="55" fill="#263821" font-size="30">Fixture venue photo</text></svg>`,
  ),
)
  .png()
  .toBuffer();

async function fixtures(page: Page, delayedPhoto = false) {
  await localMapFixture(page);
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "sidequest:environment",
      JSON.stringify({
        weather: "sunny",
        time: "midday",
        failures: ["weather"],
        reducedMotion: true,
      }),
    );
  });
  await page.route("**/api/places?**", (route) =>
    route.fulfill({
      json: {
        places: Array.from({ length: 5 }, (_, i) => ({
          ...venue,
          id: `osm-node-${980001 + i}`,
          name: i ? `Nearby outing ${i}` : venue.name,
          coordinates: {
            lat: venue.coordinates.lat + i * 0.005,
            lng: venue.coordinates.lng + i * 0.005,
          },
        })),
        source: "live",
      },
    }),
  );
  await page.route("**/_next/image?**", async (route) =>
    route.fulfill({ contentType: "image/png", body: await fixtureImage }),
  );
  await page.route("**/api/photo?**", async (route) => {
    if (
      delayedPhoto &&
      new URL(route.request().url()).searchParams.get("name") === venue.name
    ) {
      await page.waitForTimeout(1200);
      await route.fulfill({
        json: {
          image: {
            url: "https://upload.wikimedia.org/wikipedia/commons/a/a1/Selection_fixture.png",
            source:
              "https://commons.wikimedia.org/wiki/File:Selection_fixture.png",
            credit: "Fixture",
            license: "Fixture",
          },
          source: "live",
        },
      });
    } else
      await route.fulfill({ json: { image: null, source: "unavailable" } });
  });
}

async function inViewport(page: Page) {
  const card = page.locator(".map-selected");
  await expect(card).toBeVisible();
  const bounds = await card.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height,
  );
  await expect(
    card.getByRole("link", { name: /See the plan/ }),
  ).toBeInViewport();
  await expect(card.getByRole("link", { name: /Directions/ })).toBeInViewport();
  const controls = await page.locator(".map-controls").boundingBox();
  expect(controls).not.toBeNull();
  const overlaps =
    bounds!.x < controls!.x + controls!.width &&
    bounds!.x + bounds!.width > controls!.x &&
    bounds!.y < controls!.y + controls!.height &&
    bounds!.y + bounds!.height > controls!.y;
  expect(overlaps).toBe(false);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
}

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 390, height: 844 },
]) {
  test(`selected venue is visible without scrolling at ${viewport.width}px and closes independently`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await fixtures(page, true);
    await page.goto(`/map?place=${venue.id}`);
    await expect(page.locator(".map-selected")).toContainText(venue.name);
    await inViewport(page);
    await expect(page.locator(".map-selected img")).toBeVisible();
    await inViewport(page);
    if (process.env.CAPTURE_MAP_SELECTION)
      await page.screenshot({
        path: `work/map-selection-${viewport.width}.png`,
      });
    await expect(page.locator(".map-status")).toContainText("Landscape map", {
      timeout: 15000,
    });
    // Native markers outside clusters remain keyboard selectable after closing.
    for (let zoom = 0; zoom < 4; zoom++) {
      await page.getByRole("button", { name: "Zoom in", exact: true }).click();
      await page.waitForTimeout(350);
    }
    const marker = page.getByRole("button", {
      name: `Select ${venue.name}`,
      exact: true,
    });
    await page.getByRole("button", { name: "Close selected place" }).click();
    await expect(page.locator(".map-selected")).toHaveCount(0);
    await expect(marker).toHaveAttribute("aria-pressed", "false");
    await marker.focus();
    await page.keyboard.press("Enter");
    await expect(marker).toHaveAttribute("aria-pressed", "true");
    await inViewport(page);
    await page.getByRole("button", { name: "Close selected place" }).focus();
    await page.keyboard.press("Escape");
    await expect(page.locator(".map-selected")).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await marker.evaluate((el) => el === document.activeElement)) ||
          (await page
            .locator(".maplibregl-canvas")
            .evaluate((el) => el === document.activeElement)),
      )
      .toBe(true);
    await marker.focus();
    await page.keyboard.press("Enter");
    await page
      .locator(".map-selected")
      .getByRole("button", { name: `Save ${venue.name}` })
      .click();
    await expect(
      page
        .locator(".map-selected")
        .getByRole("button", { name: `Unsave ${venue.name}` }),
    ).toHaveAttribute("aria-pressed", "true");
  });
}

test("a photo arriving for the selected venue preserves the panned map camera", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await fixtures(page, true);
  await page.goto(`/map?place=${venue.id}`);
  await expect(page.locator(".map-selected")).toContainText(venue.name);
  await expect(page.locator(".map-status")).toContainText("Landscape map", {
    timeout: 15000,
  });
  await observeCamera(page);
  const canvas = page.locator(".maplibregl-canvas");
  await canvas.focus();
  await canvas.press("ArrowRight");
  await expect(
    page.getByRole("button", { name: "Search this area" }),
  ).toBeVisible();
  const camera = await cameraPosition(page);
  await expect(page.locator(".map-selected img")).toBeVisible();
  const after = await cameraPosition(page);
  expect(after.x).toBeCloseTo(camera.x, 6);
  expect(after.y).toBeCloseTo(camera.y, 6);
  expect(after.scale).toBeCloseTo(camera.scale, 2);
  await inViewport(page);
});

test("changing company clears child ages, child activity and a stale child search", async ({
  page,
}) => {
  await fixtures(page);
  await page.addInitScript(() => {
    if (!localStorage.getItem("sidequest:v1"))
      localStorage.setItem(
        "sidequest:v1",
        JSON.stringify({
          version: 1,
          preferences: {
            company: "family",
            intent: "kids",
            activity: "soft-play",
            childrenAges: [1, 2],
          },
        }),
      );
  });
  await page.route("**/api/places?**", (route) =>
    route.fulfill({
      json: {
        places: [
          {
            ...venue,
            id: "osm-node-980010",
            name: "Test Child Play",
            category: "Soft play",
            intents: ["kids"],
          },
          {
            ...venue,
            id: "osm-node-980011",
            name: "Test Museum",
            category: "Museum",
            intents: ["culture", "kids"],
          },
          {
            ...venue,
            name: "Anytime Fitness",
            category: "Fitness centre",
            intents: ["active"],
          },
        ],
        source: "live",
      },
    }),
  );
  await page.goto("/map?q=soft%20play%20for%20kids%20aged%201%20and%202");
  await expect(page.getByLabel("Who is coming")).toHaveValue("family");
  await expect(page.getByLabel("Child 1 age", { exact: true })).toHaveValue(
    "1",
  );
  await expect(page.getByLabel("Child 2 age", { exact: true })).toHaveValue(
    "2",
  );
  await expect(page.locator(".map-results")).toContainText("Test Child Play");
  await page.getByLabel("Who is coming").selectOption("solo");
  await expect(page.getByLabel("Type of outing")).toHaveValue("any");
  await expect(page.getByLabel("Child 1 age", { exact: true })).toHaveCount(0);
  await expect(page.locator(".map-results")).toContainText("Test Museum");
  await expect(page.locator(".map-results")).not.toContainText(
    "Test Child Play",
  );
  await expect(page.locator(".map-results")).not.toContainText(
    "Anytime Fitness",
  );
  expect(new URL(page.url()).searchParams.get("q")).toBeNull();
  const preferences = await page.evaluate(
    () => JSON.parse(localStorage.getItem("sidequest:v1")!).preferences,
  );
  expect(preferences.company).toBe("solo");
  expect(preferences.intent).toBe("any");
  expect(preferences.childrenAges).toBeUndefined();
  await page.reload();
  await expect(page.getByLabel("Who is coming")).toHaveValue("solo");
  await expect(page.locator(".map-results")).not.toContainText(
    "Test Child Play",
  );
});
