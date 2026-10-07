import { chromium, expect } from "@playwright/test";
import { existsSync } from "node:fs";

const base = process.env.TEST_BASE_URL || "http://localhost:3001";
const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ||
    (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({ serviceWorkers: "allow" });
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.setDefaultNavigationTimeout(30000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  const lab = await context.request.get(`${base}/dev/environment`);
  expect(lab.status()).toBe(404);
  const manifest = await (
    await context.request.get(`${base}/manifest.webmanifest`)
  ).json();
  expect(manifest.name).toContain("SideQuest");
  expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
  await page.goto(`${base}/place/virginia-water`);
  await page
    .getByRole("button", { name: "Save for later", exact: true })
    .click();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {
    timeout: 30000,
  });
  await page.goto(`${base}/saved`);
  await expect(
    page.getByRole("link", { name: /Virginia Water/ }).first(),
  ).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("link", { name: /Virginia Water/ }).first(),
  ).toBeVisible();
  await page.goto(`${base}/history`);
  await expect(
    page.getByRole("heading", { name: /A little more of the world/ }),
  ).toBeVisible();
  await page.goto(`${base}/not-cached-yet`);
  await expect(
    page.getByRole("heading", { name: /A little off the grid/ }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  console.log(
    "PASS: production Lab hidden, install manifest valid, saved and history work offline, uncached navigation recovers.",
  );
} finally {
  await browser.close();
}
