import { test, expect } from "@playwright/test";
import { PLACES } from "../../src/providers/places";
import { localMapFixture, gpuLaunchOptions } from "./fixtures/map";
test.use({ launchOptions: gpuLaunchOptions });
for (const path of ["/map", "/explore"]) {
  test(`typing stays local and does not rewrite the address on ${path}`, async ({
    page,
  }) => {
    await localMapFixture(page);
    const venue = {
      ...PLACES[0],
      id: "search-responsiveness-museum",
      name: "Lantern Search Museum",
      category: "Museum",
      environment: "indoor",
      daylightOnly: false,
      hours: undefined,
      image: undefined,
      cost: 0,
      coordinates: { lat: 51.347, lng: -0.8 },
      duration: [20, 40],
    };
    await page.route("**/api/places?**", (route) =>
      route.fulfill({ json: { places: [venue], source: "live" } }),
    );
    await page.route("**/api/photo?**", (route) =>
      route.fulfill({ json: { image: null } }),
    );
    await page.route("**/api/venue-evidence?**", (route) =>
      route.fulfill({ json: { status: "disabled", place: null } }),
    );
    await page.route("https://api.open-meteo.com/**", (route) =>
      route.fulfill({ status: 503 }),
    );
    await page.goto(path);
    const input = page.getByLabel(
      path === "/map" ? "Search map outings" : "Find something to do",
    );
    await expect(input).toBeVisible();
    const address = page.url();
    await input.pressSequentially("lantern", { delay: 20 });
    await expect(input).toHaveValue("lantern");
    expect(page.url()).toBe(address);
    if (path === "/map")
      await expect(page.locator(".map-result-row")).not.toHaveCount(1);
    await input.press("Enter");
    if (path === "/map")
      await expect(page.locator(".map-result-row")).toHaveCount(1);
    else
      await expect(page.locator(".search-interpretation")).toContainText(
        "lantern",
      );
    expect(page.url()).toBe(address);
    await expect(input).toBeFocused();
  });
}

test("dense browsing stays responsive through typing and repeated filter changes", async ({
  page,
}) => {
  test.setTimeout(90000);
  await localMapFixture(page);
  const venues = Array.from({ length: 500 }, (_, i) => ({
    ...PLACES[0],
    id: `dense-ui-${i}`,
    name: `Dense Museum ${i}`,
    category: "Museum",
    environment: "indoor",
    daylightOnly: false,
    hours: [{ days: [0, 1, 2, 3, 4, 5, 6], open: 0, close: 1440 }],
    image: undefined,
    cost: 0,
    coordinates: { lat: 51.347, lng: -0.8 },
    duration: [20, 40],
  }));
  await page.route("**/api/places?**", (route) =>
    route.fulfill({ json: { places: venues, source: "live" } }),
  );
  await page.route("**/api/photo?**", (route) =>
    route.fulfill({ json: { image: null } }),
  );
  await page.route("**/api/venue-evidence?**", (route) =>
    route.fulfill({ json: { status: "disabled", place: null } }),
  );
  await page.route("https://api.open-meteo.com/**", (route) =>
    route.fulfill({ status: 503 }),
  );
  await page.goto("/map");
  await expect(page.locator(".map-result-row")).toContainText(["Dense Museum"]);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.evaluate(() => {
    const tasks: number[] = [];
    (window as Window & { searchLongTasks?: number[] }).searchLongTasks = tasks;
    new PerformanceObserver((list) =>
      tasks.push(...list.getEntries().map((entry) => entry.duration)),
    ).observe({ entryTypes: ["longtask"] });
  });
  const address = page.url();
  const input = page.getByLabel("Search map outings");
  const start = Date.now();
  await input.pressSequentially("Dense Museum", { delay: 15 });
  expect(Date.now() - start).toBeLessThan(2500);
  expect(page.url()).toBe(address);
  await input.press("Enter");
  await expect(page.locator(".sheet-handle")).toContainText("500");
  for (let i = 0; i < 4; i++) {
    await page.getByLabel("Type of outing").selectOption("museum");
    await page.getByLabel("Type of outing").selectOption("any");
  }
  await expect(input).toHaveValue("");
  await expect(page.locator(".map-result-row")).toHaveCount(12);
  const longest = await page.evaluate(() =>
    Math.max(
      0,
      ...((window as Window & { searchLongTasks?: number[] }).searchLongTasks ??
        []),
    ),
  );
  expect(longest).toBeLessThan(1500);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
});
