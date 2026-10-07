import { test, expect } from "@playwright/test";
async function simulate(
  page: import("@playwright/test").Page,
  state: Record<string, unknown> = {},
) {
  await page.addInitScript((o) => {
    sessionStorage.setItem(
      "sidequest:environment",
      JSON.stringify({
        weather: "sunny",
        time: "midday",
        failures: ["weather", "map"],
        ...o,
      }),
    );
  }, state);
}
test("escape, save, reload, collection and visit", async ({ page }) => {
  await simulate(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Get me out of the house" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Let’s go" })
    .click();
  await page
    .getByRole("button", { name: "Save for later", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Saved for later", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Been here", exact: true }).click();
  await page.getByRole("button", { name: "Loved it", exact: true }).click();
  await page
    .getByPlaceholder("Worth the detour? Anything to remember?")
    .fill("A good little escape.");
  await page.getByRole("button", { name: "Save my visit" }).click();
  await page.goto("/history");
  await expect(
    page.getByText("A good little escape.", { exact: true }),
  ).toBeVisible();
  await page.goto("/saved");
  await page.getByRole("button", { name: "New collection" }).click();
  await page.getByPlaceholder("Slow Sundays, perhaps").fill("Slow Sundays");
  await page.getByRole("button", { name: "Create collection" }).click();
  await expect(
    page.getByRole("button", { name: "Slow Sundays 0" }),
  ).toBeVisible();
});
test("plan stays within window and can be saved", async ({ page }) => {
  await simulate(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Build my afternoon", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toContainText("Back home");
  await page.getByRole("button", { name: "Save this afternoon" }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.goto("/saved");
  await expect(page.getByText("Afternoons in your pocket.")).toBeVisible();
});
test("reopened plan food and time adjustments retain its original context", async ({
  page,
}) => {
  await simulate(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Build my afternoon", exact: true })
    .first()
    .click();
  await expect(page.locator(".timeline")).toContainText(
    /coffee or picnic|Bring a picnic/,
  );
  await page.getByRole("button", { name: "Save this afternoon" }).click();
  const initial = await page.evaluate(
    () => JSON.parse(localStorage.getItem("sidequest:v1")!).plans[0],
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.goto("/saved");
  await page.getByRole("button", { name: /Change starting location/ }).click();
  await page.getByRole("button", { name: "Windsor", exact: true }).click();
  await page.locator(".saved-plans > div > button").first().click();
  await page.getByRole("button", { name: "Remove food break" }).click();
  await expect(page.locator(".timeline")).not.toContainText(
    /coffee or picnic|Bring a picnic/,
  );
  await page.getByRole("button", { name: "Make it shorter" }).click();
  await expect(page.locator(".timeline")).toContainText("Leave Sandhurst");
  await page.getByRole("button", { name: "Save this afternoon" }).click();
  const changed = await page.evaluate(
    () => JSON.parse(localStorage.getItem("sidequest:v1")!).plans[0],
  );
  expect(changed.origin).toEqual(initial.origin);
  expect(changed.start).toBe(initial.start);
  expect(changed.minutes).toBeLessThanOrEqual(120);
});
test("shared afternoon preserves the sender's intent", async ({ page }) => {
  await simulate(page);
  const data = {
    origin: { name: "Sandhurst", lat: 51.347, lng: -0.8 },
    start: new Date().toISOString().slice(0, 10) + "T12:00:00+01:00",
    query: { minutes: 180, travel: 30, budget: 40, intent: "scenic" },
    food: false,
  };
  await page.goto(
    `/afternoon?plan=${encodeURIComponent(JSON.stringify(data))}`,
  );
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Save this afternoon" }).click();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("sidequest:v1")!).plans[0].query.intent,
    ),
  ).toBe("scenic");
});
test("location denial offers immediate town fallback", async ({ page }) => {
  await simulate(page, { failures: ["weather", "map", "location-denied"] });
  await page.goto("/");
  await page.getByRole("button", { name: /Change starting location/ }).click();
  await page.getByRole("button", { name: "Use my location" }).click();
  await expect(
    page.getByText("Location access is off. Pick your starting town below."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Windsor", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Change starting location: Windsor" }),
  ).toBeVisible();
});
test("lab overrides share context and map failure preserves decisions", async ({
  page,
}) => {
  await page.goto("/dev/environment");
  await expect(
    page.getByRole("heading", { name: "Environment Lab" }),
  ).toBeVisible();
  await page.getByLabel("Weather", { exact: true }).selectOption("heavy-rain");
  await page.getByLabel("Time of day").selectOption("midnight");
  await page.getByLabel("Map provider unavailable").check();
  await expect(
    page.getByText("Location overview · map unavailable"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Discovery", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A little rain. Still plenty to do." }),
  ).toBeVisible();
});
test("malformed shared plan and unknown place recover", async ({ page }) => {
  await page.goto("/afternoon?plan=%7Bbad");
  await expect(
    page.getByRole("heading", { name: "That plan took a wrong turn." }),
  ).toBeVisible();
  await page.goto("/place/does-not-exist");
  await expect(
    page.getByRole("heading", { name: "A little off the path." }),
  ).toBeVisible();
});

test("search suggestions update intent across client navigation", async ({
  page,
}) => {
  await simulate(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Search places and ideas" }).click();
  await page.getByRole("link", { name: "Something indoors with kids" }).click();
  await expect(page.locator(".search-interpretation")).toContainText("indoors");
  await expect(page.locator(".search-interpretation")).toContainText(
    "Something indoors with kids",
  );
});
test("320px phone fits with keyboard-accessible primary action", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await simulate(page);
  await page.goto("/");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );
  await page.getByRole("button", { name: "Get me out of the house" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Get me out of the house" }),
  ).toBeFocused();
});
test("saved map marker can select an ineligible place without fake score", async ({
  page,
}) => {
  await simulate(page, { time: "midnight" });
  await page.addInitScript(() =>
    localStorage.setItem(
      "sidequest:v1",
      JSON.stringify({ version: 1, saved: ["virginia-water"] }),
    ),
  );
  await page.goto("/map?place=virginia-water");
  await expect(page.locator(".map-selected")).toContainText("Virginia Water");
  await expect(page.locator(".map-selected")).toContainText(
    "Saved for another day",
  );
});

test("vector map connects selection and mobile sheet with a local style fixture", async ({
  page,
}) => {
  await simulate(page, { failures: ["weather"] });
  await page.route("https://tiles.openfreemap.org/styles/positron", (route) =>
    route.fulfill({
      json: {
        version: 8,
        glyphs: "http://localhost:3000/test-fonts/{fontstack}/{range}.pbf",
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
  await page.route("**/test-fonts/**", (route) =>
    route.fulfill({
      contentType: "application/x-protobuf",
      body: Buffer.alloc(0),
    }),
  );
  await page.goto("/map");
  await expect(page.getByText("Your next detour", { exact: true })).toBeVisible(
    { timeout: 20000 },
  );
  const row = page.locator(".map-result-row").nth(1);
  const name = await row.locator("strong").innerText();
  await row.click();
  await expect(page.locator(".map-selected .place-title")).toContainText(name);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Expand results" }).click();
  await expect(page.locator(".map-sidebar")).toHaveClass(/expanded/);
  await page.getByRole("button", { name: "Collapse results" }).click();
  await expect(page.locator(".map-sidebar")).not.toHaveClass(/expanded/);
});
