import { test, expect } from "@playwright/test";
import { PLACES } from "../../src/providers/places";
import { localMapFixture, gpuLaunchOptions } from "./fixtures/map";
test.use({ launchOptions: gpuLaunchOptions });
async function setup(page: import("@playwright/test").Page) {
  await localMapFixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const generic = {
    ...PLACES[0],
    id: "overhaul-generic",
    name: "Lantern Local Attraction",
    category: "Local attraction",
    environment: "indoor",
    daylightOnly: false,
    hours: undefined,
    image: undefined,
    suitability: undefined,
    intents: ["unusual"],
    cost: 7,
    duration: [20, 40],
    coordinates: { lat: 51.347, lng: -0.8 },
  };
  await page.route("**/api/places?**", (route) =>
    route.fulfill({ json: { places: [generic], source: "live" } }),
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
}
test("map Reset filters clears the whole selection including optional food", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/map");
  await page.getByLabel("Who is coming").selectOption("family");
  await page.getByLabel("Time available").selectOption("480");
  await page.getByLabel("Maximum travel time").selectOption("60");
  await page.getByLabel("Include food & coffee", { exact: true }).check();
  await page
    .getByRole("button", { name: "Reset filters", exact: true })
    .click();
  await expect(page.getByLabel("Who is coming")).toHaveValue("couple");
  await expect(page.getByLabel("Time available")).toHaveValue("180");
  await expect(page.getByLabel("Maximum travel time")).toHaveValue("30");
  await expect(
    page.getByLabel("Include food & coffee", { exact: true }),
  ).not.toBeChecked();
});
test("generic attraction cards do not claim an unsupported unusual match", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/explore?intent=unusual");
  const card = page
    .locator("article.place-card")
    .filter({ hasText: "Lantern Local Attraction" });
  await expect(card).toBeVisible();
  await expect(card.locator("summary")).not.toContainText(
    "Something different",
  );
});

test("planner child ages remain editable after changing company", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/explore");
  await page.getByRole("button", { name: "Plan my day", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Who’s coming", exact: true })
    .selectOption("family");
  await dialog.getByLabel("Planner child 1 age").selectOption("0");
  await expect(dialog.getByLabel("Planner child 1 age")).toHaveValue("0");
  await dialog
    .getByRole("combobox", { name: "Who’s coming", exact: true })
    .selectOption("solo");
  await dialog
    .getByRole("combobox", { name: "Who’s coming", exact: true })
    .selectOption("family");
  await expect(dialog.getByLabel("Planner child 1 age")).toHaveValue("");
  await dialog.getByLabel("Planner child 1 age").selectOption("0");
  await expect(dialog.getByLabel("Planner child 1 age")).toHaveValue("0");
  await dialog.getByRole("button", { name: "Add child", exact: true }).click();
  await dialog.getByLabel("Planner child 2 age").selectOption("7");
  await expect(dialog.getByLabel("Planner child 2 age")).toHaveValue("7");
  await dialog.getByRole("button", { name: "Remove planner child 2" }).click();
  await expect(dialog.getByLabel("Planner child 2 age")).toHaveCount(0);
});
