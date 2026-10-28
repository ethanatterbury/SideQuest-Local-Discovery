import { test, expect } from "@playwright/test";
import { PLACES } from "../../src/providers/places";
import type { Place } from "../../src/domain/models";

test("verified primary play appears with cafés off while an ordinary café stays hidden", async ({
  page,
}) => {
  const cafe: Place = {
    ...PLACES[0],
    id: "osm-node-987650001",
    name: "Acorn & Oak",
    category: "Café",
    optionalCategory: "food",
    environment: "indoor",
    company: ["family", "solo", "friends", "couple"],
    intents: ["food", "relax"],
    coordinates: { lat: 51.347, lng: -0.8 },
    image: undefined,
    ageRange: undefined,
    familyFeatures: [],
    experiences: undefined,
    suitability: undefined,
    cost: null,
    daylightOnly: false,
  };
  const ordinary = {
    ...cafe,
    id: "osm-node-987650002",
    name: "Ordinary Coffee",
  };
  const evidence = {
    source: "official" as const,
    confidence: "verified" as const,
    url: "https://acorn-oak.co.uk/play",
    checkedAt: new Date().toISOString(),
  };
  const verified: Place = {
    ...cafe,
    category: "Play café",
    optionalCategory: undefined,
    intents: ["kids", "active"],
    experiences: [{ primary: true, activities: ["soft-play"], evidence }],
  };
  await page.addInitScript(() => {
    localStorage.setItem(
      "sidequest:v1",
      JSON.stringify({
        version: 1,
        preferences: {
          company: "family",
          childrenAges: [],
          includeCategories: [],
        },
      }),
    );
    sessionStorage.setItem(
      "sidequest:environment",
      JSON.stringify({
        weather: "sunny",
        time: "midday",
        failures: ["weather", "map"],
      }),
    );
  });
  await page.route("**/data/venues/manifest.json", (route) =>
    route.fulfill({ json: { cells: {} } }),
  );
  await page.route("**/api/places?**", (route) =>
    route.fulfill({ json: { places: [cafe, ordinary], source: "live" } }),
  );
  await page.route("**/api/photo?**", (route) =>
    route.fulfill({ json: { image: null } }),
  );
  let started = false;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/venue-evidence?**", async (route) => {
    const id = new URL(route.request().url()).searchParams.get("id");
    if (id !== cafe.id)
      return route.fulfill({ json: { status: "unknown", place: null } });
    started = true;
    await ready;
    await route.fulfill({ json: { status: "verified", place: verified } });
  });
  await page.goto("/map");
  const food = page.getByRole("checkbox", { name: "Include food & coffee" });
  await expect(food).not.toBeChecked();
  await expect.poll(() => started).toBe(true);
  await expect(page.locator(".map-results")).not.toContainText(cafe.name);
  release();
  await expect(page.locator(".map-results")).toContainText(cafe.name);
  await expect(food).not.toBeChecked();
  await expect(page.locator(".map-results")).not.toContainText(ordinary.name);
  await page.getByLabel("Type of outing").selectOption("soft-play");
  await expect(page.locator(".map-results")).toContainText(cafe.name);
});
