import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
const base = process.env.TEST_BASE_URL || "http://localhost:3000";
const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ||
    (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const out = "work/visual-matrix";
mkdirSync(out, { recursive: true });
const sizes = [
  ["small-iphone", 320, 568],
  ["iphone", 390, 844],
  ["large-iphone", 430, 932],
  ["android", 360, 780],
  ["landscape", 844, 390],
  ["tablet", 768, 1024],
  ["tablet-landscape", 1024, 768],
  ["laptop", 1366, 768],
  ["desktop", 1440, 900],
  ["wide", 2560, 1440],
  ["split", 820, 900],
];
const states = [
  ["clear-midday", "clear", "midday", []],
  ["clear-golden", "clear", "golden-hour", []],
  ["clear-night", "clear", "midnight", []],
  ["overcast", "overcast", "midday", []],
  ["rain-day", "light-rain", "midday", []],
  ["rain-night", "heavy-rain", "midnight", []],
  ["fog-morning", "fog", "morning", []],
  ["snow-evening", "snow", "evening", []],
  ["reduced-rain", "heavy-rain", "midday", [], true],
  ["map-unavailable", "clear", "midday", ["map"]],
  ["weather-unavailable", "clear", "midday", ["weather"]],
  ["location-denied", "clear", "midday", ["location-denied"]],
  ["offline", "clear", "midday", ["offline"]],
];
const report = [];
async function capture(name, width, height, route, overrides) {
  const context = await browser.newContext({
    viewport: { width, height },
    serviceWorkers: "block",
  });
  await context.addInitScript(
    (o) => sessionStorage.setItem("sidequest:environment", JSON.stringify(o)),
    overrides,
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + route);
  await page.waitForTimeout(route === "/map" ? 1300 : 700);
  await page.locator("img").evaluateAll(async (images) => {
    images.forEach((img) => (img.loading = "eager"));
    await Promise.all(images.map((img) => img.decode().catch(() => {})));
  });
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  const scroll = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  report.push({
    name,
    width,
    height,
    scroll,
    overflow: scroll > width,
    errors,
  });
  console.log(
    name,
    scroll > width ? "OVERFLOW" : "fits",
    errors.length ? "ERROR" : "",
  );
  await context.close();
}
for (const [name, w, h] of sizes)
  await capture(name, w, h, "/", {
    weather: "sunny",
    time: "midday",
    failures: ["map"],
  });
for (const [name, weather, time, failures, motion] of states)
  await capture(name, 1440, 900, "/map", {
    weather,
    time,
    failures: [...new Set([...failures, "map"])],
    reducedMotion: motion || false,
  });
await capture("place-desktop", 1440, 900, "/place/virginia-water", {
  weather: "sunny",
  time: "midday",
  failures: ["map"],
});
await capture("place-mobile", 390, 844, "/place/virginia-water", {
  weather: "sunny",
  time: "midday",
  failures: ["map"],
});
await capture("lab-desktop", 1440, 900, "/dev/environment", {
  weather: "heavy-rain",
  time: "midnight",
  failures: ["map"],
});
await capture("map-mobile", 390, 844, "/map", {
  weather: "fog",
  time: "morning",
  failures: ["map"],
});
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
await browser.close();
if (report.some((r) => r.overflow || r.errors.length)) process.exitCode = 1;
