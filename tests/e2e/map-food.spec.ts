import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { Place } from "../../src/domain/models";

const icon = readFileSync("public/icons/icon-192.png");
const base: Place = {
  id: "osm-node-990001",
  name: "Test Soft Play",
  area: "Test area",
  coordinates: { lat: 51.347, lng: -0.8 },
  category: "Soft play",
  description: "A fixture outing",
  tagline: "A fixture outing",
  environment: "indoor",
  intents: ["kids"],
  company: ["family", "couple", "solo", "friends"],
  duration: [30, 60],
  cost: 0,
  costLabel: "Free",
  novelty: 0.9,
  daylightOnly: false,
  website: "https://example.com",
  source: "https://www.openstreetmap.org/node/990001",
  notes: [],
};
const cafe: Place = {
  ...base,
  id: "osm-node-990002",
  name: "Test Café",
  coordinates: { lat: 51.37, lng: -0.8 },
  category: "Café",
  intents: ["food", "relax", "date"],
};
const costly: Place = {
  ...cafe,
  id: "osm-node-990003",
  name: "Unaffordable Café",
  cost: 250,
};
async function fixtures(page: Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "sidequest:environment",
      JSON.stringify({
        weather: "sunny",
        time: "midday",
        failures: ["weather"],
      }),
    );
    localStorage.setItem(
      "sidequest:v1",
      JSON.stringify({ version: 1, saved: ["osm-node-990002"], visits: [] }),
    );
  });
  await page.route("**/api/places?**", (route) =>
    route.fulfill({
      json: {
        places: [
          base,
          cafe,
          costly,
          {
            ...base,
            id: "osm-node-990004",
            name: "Test Arts Centre",
            category: "Arts centre & grounds",
            intents: ["culture", "food"],
            coordinates: { lat: 51.35, lng: -0.81 },
          },
        ],
        source: "live",
      },
    }),
  );
  await page.route("**/api/photo?**", (route) =>
    route.fulfill({ json: { image: null, source: "unavailable" } }),
  );
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: icon }),
  );
}

test("Map excludes food by default and adds coffee alongside the chosen outing", async ({
  page,
}) => {
  await fixtures(page);
  await page.goto("/map");
  const includeFood = page.getByRole("checkbox", {
    name: "Include food & coffee",
  });
  await expect(includeFood).not.toBeChecked();
  await expect(
    page.getByLabel("Type of outing").locator('option[value="food"]'),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Select Test Arts Centre", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Type of outing").selectOption("soft-play");
  await expect(page.locator(".map-result-row")).toContainText([
    "Test Soft Play",
  ]);
  await expect(
    page.getByRole("button", { name: /Select Test Café/ }),
  ).toHaveCount(0);
  await expect(page.locator(".map-results")).not.toContainText("Café");
  await includeFood.check();
  await expect(
    page.getByRole("button", { name: /Select Test Café/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Select Test Soft Play", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".map-results")).toContainText("Test Soft Play");
  await expect(page.locator(".map-results")).toContainText("Test Café");
  await expect(
    page.getByRole("button", { name: /Select Unaffordable Café/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /Select Test Café/ }).click();
  await expect(page.locator(".map-selected")).toContainText("Test Café");
  await includeFood.uncheck();
  await expect(
    page.getByRole("button", { name: /Select Test Café/ }),
  ).toHaveCount(0);
  await expect(page.locator(".map-selected")).toContainText("Test Soft Play");
  await expect(page.locator(".map-selected")).not.toContainText("Test Café");
});

test("Discover retains Food & coffee as an activity without the map checkbox", async ({
  page,
}) => {
  await fixtures(page);
  await page.goto("/explore");
  await expect(
    page.getByRole("checkbox", { name: "Include food & coffee" }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Type of outing").locator('option[value="food"]'),
  ).toHaveText("Food & coffee");
  await page.getByLabel("Type of outing").selectOption("food");
  await expect(page.locator(".results-grid")).toContainText("Test Café");
  await expect(page.locator(".results-grid")).not.toContainText(
    "Test Soft Play",
  );
});

test("an explicitly linked food place remains navigable with food unchecked", async ({
  page,
}) => {
  await fixtures(page);
  await page.goto("/map?place=osm-node-990002&activity=food");
  await expect(
    page.getByRole("checkbox", { name: "Include food & coffee" }),
  ).not.toBeChecked();
  await expect(page.getByLabel("Type of outing")).toHaveValue("any");
  await expect(page.locator(".map-selected")).toContainText("Test Café");
  await expect(
    page.getByRole("button", { name: /Select Test Café/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".map-results")).not.toContainText("Café");
  await expect(
    page.locator(".map-selected").getByRole("link", { name: /See the plan/ }),
  ).toHaveAttribute("href", "/place/osm-node-990002");
});
