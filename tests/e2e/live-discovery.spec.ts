import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { Place } from "../../src/domain/models";
const icon = readFileSync("public/icons/icon-192.png");
function fixture(index: number, patch: Partial<Place> = {}): Place {
  return {
    id: `osm-node-${900000 + index}`,
    name: `Test Museum ${index}`,
    area: "Test area",
    coordinates: { lat: 51.347 + index * 0.0001, lng: -0.8 },
    category: "Museum",
    description: "A test fixture.",
    tagline: "Museum near you",
    environment: "indoor",
    intents: ["kids", "culture"],
    company: ["family", "couple", "solo", "friends"],
    duration: [30, 60],
    cost: 0,
    costLabel: "Free entry",
    novelty: 0.8,
    daylightOnly: false,
    website: "https://www.openstreetmap.org/node/1",
    source: "https://www.openstreetmap.org/node/1",
    notes: ["Test fixture"],
    ...patch,
  };
}
async function source(page: import("@playwright/test").Page, places: Place[]) {
  await page.addInitScript(() =>
    sessionStorage.setItem(
      "sidequest:environment",
      JSON.stringify({
        weather: "sunny",
        time: "midday",
        failures: ["weather"],
      }),
    ),
  );
  await page.route("**/api/places?**", (route) =>
    route.fulfill({ json: { places, source: "live" } }),
  );
  await page.route("**/api/photo?**", (route) =>
    route.fulfill({ json: { image: null, source: "unavailable" } }),
  );
}
test("live discovery provides more pages of ideas and preserves saved live places", async ({
  page,
}) => {
  const places = Array.from({ length: 40 }, (_, i) => fixture(i));
  await source(page, places);
  await page.goto("/explore");
  await expect(page.getByText(/Live places from OpenStreetMap/)).toBeVisible();
  await expect(page.locator(".results-grid > article")).toHaveCount(12);
  await page.getByRole("button", { name: "Show 12 more ideas" }).click();
  await expect(page.locator(".results-grid > article")).toHaveCount(24);
  await page.getByRole("link", { name: "Test Museum 0", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Test Museum 0", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save for later", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Saved for later", exact: true }),
  ).toBeVisible();
  await page.goto("/saved");
  await expect(
    page.getByRole("link", { name: /Test Museum 0/ }).first(),
  ).toBeVisible();
});
test("child ages and soft play filter update recommendations and survive reload", async ({
  page,
}) => {
  await source(page, [
    fixture(0, {
      name: "Test Soft Play",
      category: "Indoor soft play",
      familyFeatures: ["Soft play"],
      ageRange: [0, 6],
    }),
    fixture(1, {
      name: "Test Older Play",
      category: "Indoor soft play",
      familyFeatures: ["Soft play"],
      ageRange: [7, 17],
    }),
  ]);
  await page.goto("/explore");
  await page
    .getByRole("combobox", { name: "Who is coming" })
    .selectOption("family");
  await page
    .getByRole("combobox", { name: "Child 1 age", exact: true })
    .selectOption("2");
  await page
    .getByRole("combobox", { name: "Type of outing" })
    .selectOption("soft-play");
  await expect(
    page.getByRole("link", { name: "Test Soft Play", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Test Older Play", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Child 1 age", exact: true }),
  ).toHaveValue("2");
  await expect(
    page.getByRole("combobox", { name: "Type of outing" }),
  ).toHaveValue("soft-play");
  await page.setViewportSize({ width: 320, height: 568 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("a browser without WebGL gets a street map with working controls in the Lab", async ({
  page,
}) => {
  await source(page, [fixture(0)]);
  await page.addInitScript(() =>
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value: () => null,
    }),
  );
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: icon }),
  );
  await page.goto("/dev/environment");
  await expect(page.locator('[data-map-engine="leaflet"]')).toBeVisible();
  await expect(page.locator(".leaflet-tile-loaded").first()).toBeVisible();
  await expect(
    page.getByText("Street map · your next detour", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect
    .poll(() => page.locator('.leaflet-tile-loaded[src*="/12/"]').count())
    .toBeGreaterThan(0);
  await page
    .getByRole("checkbox", { name: "Weather unavailable", exact: true })
    .uncheck();
  await page
    .getByRole("combobox", { name: "Weather", exact: true })
    .selectOption("heavy-rain");
  await expect(page.locator(".weather-atmosphere.heavy-rain")).toBeVisible();
  await page
    .getByRole("combobox", { name: "Time of day", exact: true })
    .selectOption("midnight");
  await expect(page.locator(".raster-map")).toHaveClass(/raster-night/);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("visible live places resolve a photo automatically and retain it across reload", async ({
  page,
}) => {
  await source(page, [fixture(0)]);
  let lookups = 0;
  await page.route("**/api/photo?**", (route) => {
    const name = new URL(route.request().url()).searchParams.get("name");
    if (name === "Test Museum 0") lookups++;
    return route.fulfill({
      json: {
        image:
          name === "Test Museum 0"
            ? {
                url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Test_fixture.jpg",
                source:
                  "https://commons.wikimedia.org/wiki/File:Test_fixture.jpg",
                credit: "Test photographer",
                license: "CC BY-SA 4.0",
              }
            : null,
        source: "live",
      },
    });
  });
  await page.route("**/_next/image?**", (route) =>
    route.fulfill({ contentType: "image/png", body: icon }),
  );
  await page.goto("/explore");
  const photo = page.locator('img[alt="Test Museum 0"]').first();
  await expect(photo).toBeVisible();
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  expect(lookups).toBe(1);
  await page.getByRole("link", { name: "Test Museum 0", exact: true }).click();
  await expect(
    page.getByText("Test photographer · CC BY-SA 4.0"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save for later", exact: true })
    .click();
  await page.reload();
  await expect(page.locator('img[alt="Test Museum 0"]').first()).toBeVisible();
  expect(lookups).toBe(1);
});

test("a shared live afternoon loads the sender's area before building", async ({
  page,
}) => {
  await source(page, []);
  const origin = { name: "London test area", lat: 51.5, lng: -0.1 };
  const places = [
    fixture(70, {
      name: "Shared Soft Play",
      category: "Indoor soft play",
      coordinates: origin,
      familyFeatures: ["Soft play"],
      ageRange: [0, 6],
    }),
  ];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/places?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("lng") !== "-0.1")
      return route.fulfill({ json: { places: [], source: "live" } });
    await pending;
    await route.fulfill({ json: { places, source: "live" } });
  });
  const data = {
    origin,
    start: new Date().toISOString().slice(0, 10) + "T12:00:00+01:00",
    query: {
      minutes: 180,
      travel: 30,
      budget: 40,
      company: "family",
      activity: "soft-play",
      childrenAges: [2],
    },
    food: false,
  };
  await page.goto(
    `/afternoon?plan=${encodeURIComponent(JSON.stringify(data))}`,
  );
  await expect(
    page.getByRole("heading", { name: "Finding this afternoon…" }),
  ).toBeVisible();
  release();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("Shared Soft Play", { exact: true }),
  ).toBeVisible();
});

test("a photo update preserves the chosen map place and camera", async ({
  page,
}) => {
  await source(page, [fixture(0), fixture(1)]);
  await page.addInitScript(() =>
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value: () => null,
    }),
  );
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: icon }),
  );
  let started = false;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/photo?**", async (route) => {
    if (
      new URL(route.request().url()).searchParams.get("name") !==
      "Test Museum 1"
    )
      return route.fulfill({ json: { image: null, source: "unavailable" } });
    started = true;
    await pending;
    await route.fulfill({
      json: {
        image: {
          url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Test_fixture.jpg",
          source: "https://commons.wikimedia.org/wiki/File:Test_fixture.jpg",
          credit: "Test photographer",
          license: "CC BY-SA 4.0",
        },
        source: "live",
      },
    });
  });
  await page.route("**/_next/image?**", (route) =>
    route.fulfill({ contentType: "image/png", body: icon }),
  );
  await page.goto("/map?place=osm-node-900000");
  const chosen = page
    .locator(".map-result-row")
    .filter({ hasText: "Test Museum 1" });
  await chosen.click();
  await expect(chosen).toHaveClass(/selected/);
  await page.locator(".map-selected .place-image").scrollIntoViewIfNeeded();
  await expect.poll(() => started).toBe(true);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect
    .poll(() => page.locator('.leaflet-tile-loaded[src*="/12/"]').count())
    .toBeGreaterThan(0);
  const map = page.locator('[data-map-engine="leaflet"]');
  await expect(map).not.toHaveClass(/leaflet-zoom-anim/);
  const pane = page.locator(".leaflet-map-pane");
  const beforePan = await pane.getAttribute("style");
  await map.focus();
  await map.press("ArrowRight");
  await expect.poll(() => pane.getAttribute("style")).not.toBe(beforePan);
  await expect(pane).not.toHaveClass(/leaflet-pan-anim/);
  const camera = await pane.getAttribute("style");
  release();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("sidequest:places:v1") || "[]").find(
            (p: Place) => p.id === "osm-node-900001",
          )?.image?.credit,
      ),
    )
    .toBe("Test photographer");
  await expect(chosen).toHaveClass(/selected/);
  await expect(pane).toHaveAttribute("style", camera!);
});
