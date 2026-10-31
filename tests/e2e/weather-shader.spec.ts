import { expect, test } from "@playwright/test";
import {
  createAtmosphereRenderer,
  WEATHER_FRAGMENT,
} from "../../src/features/map/atmosphere-renderer";
import { gpuLaunchOptions } from "./fixtures/map";

test.use({ launchOptions: gpuLaunchOptions });

// Exercise the production shader directly, without app, map, network, or tiles.
test("precipitation remains visible within a bounded overlay at low GPU resolution", async ({
  page,
}) => {
  const result = await page.evaluate(
    ({ fragment, factory }) => {
      const canvas = document.createElement("canvas");
      canvas.style.cssText = "width:1000px;height:700px";
      document.body.appendChild(canvas);
      const renderer = new Function("WEATHER_FRAGMENT", `return (${factory})`)(
        fragment,
      )(canvas) as ReturnType<typeof createAtmosphereRenderer>;
      if (!renderer) throw new Error("GPU renderer unavailable");
      const gl = canvas.getContext("webgl")!;
      const base = {
        time: 8,
        rain: 0,
        snow: 0,
        wind: 0.18,
        direction: 3.92,
        gust: 0.1,
        cloud: 0,
        fog: 0,
        night: 0,
        golden: 0,
        motion: 1,
        storm: 0,
      };
      const draw = (values: Record<string, number>, scale = 0.65) => {
        renderer.draw({ ...base, ...values }, scale);
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(
          0,
          0,
          canvas.width,
          canvas.height,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixels,
        );
        return pixels;
      };
      const visibleRain = (rain: number, scale: number) => {
        const dry = draw({}, scale);
        const wet = draw({ rain }, scale);
        let visible = 0;
        for (let i = 3; i < wet.length; i += 4)
          if (wet[i] - dry[i] > 12) visible++;
        return visible / (wet.length / 4);
      };
      const lightLow = visibleRain(0.8 / 15, 0.65);
      const lightHigh = visibleRain(0.8 / 15, 1);
      const heavy = visibleRain(12 / 15, 0.65);
      const clouds = draw({ cloud: 1 });
      const drift = draw({ cloud: 1, time: 10 });
      let changed = 0;
      let cloudMaxAlpha = 0;
      for (let i = 0; i < clouds.length; i++) {
        if (Math.abs(clouds[i] - drift[i]) > 1) changed++;
        if (i % 4 === 3)
          cloudMaxAlpha = Math.max(cloudMaxAlpha, clouds[i] / 255);
      }
      const still = draw({ cloud: 1, rain: 0.8 / 15, motion: 0 });
      const later = draw({
        cloud: 1,
        rain: 0.8 / 15,
        motion: 0,
        time: 20,
        cameraX: 0.7,
        cameraScale: 512 * 32,
      });
      const staticAndCameraIndependent = still.every(
        (value, index) => value === later[index],
      );
      const error = gl.getError();
      renderer.dispose();
      return {
        lightLow,
        lightHigh,
        heavy,
        cloudMaxAlpha,
        changed: changed / clouds.length,
        staticAndCameraIndependent,
        error,
      };
    },
    {
      fragment: WEATHER_FRAGMENT,
      factory: createAtmosphereRenderer.toString(),
    },
  );
  // A measurable drizzle floor, with ample clear pixels for operated map UI.
  expect(result.lightLow).toBeGreaterThan(0.005);
  expect(result.lightLow).toBeLessThan(0.06);
  expect(result.lightLow / result.lightHigh).toBeGreaterThan(0.8);
  expect(result.lightLow / result.lightHigh).toBeLessThan(1.6);
  expect(result.heavy).toBeGreaterThan(result.lightLow * 1.8);
  expect(result.cloudMaxAlpha).toBeLessThan(0.31);
  expect(result.changed).toBeGreaterThan(0.1);
  expect(result.staticAndCameraIndependent).toBe(true);
  expect(result.error).toBe(0);
});
