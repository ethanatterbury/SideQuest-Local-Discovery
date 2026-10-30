import { expect, it } from "vitest";
import {
  mapPixelRatio,
  weatherPixelRatio,
} from "../src/features/map/render-budget";
it("bounds GPU canvas allocations on large high-density monitors", () => {
  expect(7680 * 4320 * mapPixelRatio(7680, 4320, 2) ** 2).toBeLessThanOrEqual(
    8000001,
  );
  expect(
    3840 * 2160 * weatherPixelRatio(3840, 2160, 1.25) ** 2,
  ).toBeLessThanOrEqual(1000001);
});
it("keeps native map sharpness and weather quality on ordinary viewports", () => {
  expect(mapPixelRatio(1200, 700, 2)).toBe(2);
  expect(weatherPixelRatio(800, 500, 1.25)).toBe(1.25);
  expect(weatherPixelRatio(400, 600, 0.65)).toBe(0.65);
});
