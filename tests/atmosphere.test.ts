import { describe, expect, it } from "vitest";
import { atmosphereMetrics } from "../src/domain/atmosphere";
import { applyOverrides, WEATHER_PRESETS } from "../src/domain/environment";
import { solarPhase } from "../src/domain/time";
import type { Environment, TimeKind, WeatherKind } from "../src/domain/models";

const env: Environment = {
  now: "2026-12-15T12:00:00Z",
  location: { name: "Fleet", lat: 51.28, lng: -0.84 },
  weather: {
    kind: "clear",
    temperature: 12,
    rain: 0,
    wind: 5,
    visibility: 20,
    sunrise: "2026-12-15T08:05:00Z",
    sunset: "2026-12-15T15:55:00Z",
    observedAt: "2026-12-15T12:00:00Z",
    source: "live",
  },
  reducedMotion: false,
  failures: [],
};
describe("solar atmosphere simulation", () => {
  it("every preview selects its named phase against the actual winter sun", () => {
    const phases: Exclude<TimeKind, "live">[] = [
      "sunrise",
      "morning",
      "midday",
      "golden-hour",
      "sunset",
      "evening",
      "midnight",
    ];
    for (const time of phases) {
      const next = applyOverrides(env, { time });
      expect(
        solarPhase(next.now, next.weather.sunrise, next.weather.sunset),
      ).toBe(time);
      expect(next.weather.sunrise).toBe(env.weather.sunrise);
      expect(next.weather.sunset).toBe(env.weather.sunset);
    }
  });
  it("uses the actual summer sunset rather than a fixed clock time", () => {
    const summer = {
      ...env,
      now: "2026-06-15T12:00:00Z",
      weather: {
        ...env.weather,
        sunrise: "2026-06-15T04:40:00+01:00",
        sunset: "2026-06-15T21:20:00+01:00",
      },
    };
    expect(applyOverrides(summer, { time: "golden-hour" }).now).toBe(
      "2026-06-15T19:20:00.000Z",
    );
  });
});
describe("measurement-driven weather", () => {
  it("all weather presets have coherent measurements and storms include rain", () => {
    for (const weather of Object.keys(WEATHER_PRESETS) as WeatherKind[]) {
      expect(applyOverrides(env, { weather }).weather).toMatchObject({
        ...WEATHER_PRESETS[weather],
        source: "simulation",
      });
    }
    const storm = atmosphereMetrics(
      applyOverrides(env, { weather: "thunderstorm" }).weather,
    );
    expect(storm.rainCount).toBeGreaterThan(100);
    expect(storm.cloud).toBe(1);
  });
  it("rain amount changes density and fall speed even under a clear label", () => {
    const light = atmosphereMetrics({ ...env.weather, rain: 0.5 });
    const heavy = atmosphereMetrics({ ...env.weather, rain: 15 });
    expect(light.rainCount).toBeGreaterThan(38);
    expect(heavy.rainCount).toBeGreaterThan(light.rainCount * 2);
    expect(heavy.rainDuration).toBeLessThan(light.rainDuration);
    expect(atmosphereMetrics({ ...env.weather, rain: 0 }).rainCount).toBe(0);
  });
  it("wind speed changes trails, speed, and clouds independently of labels", () => {
    const calm = atmosphereMetrics({ ...env.weather, wind: 0 });
    const breeze = atmosphereMetrics({ ...env.weather, wind: 20 });
    const gale = atmosphereMetrics({ ...env.weather, wind: 90 });
    expect(calm.windCount).toBe(0);
    expect(breeze.windCount).toBeGreaterThan(0);
    expect(gale.windCount).toBeGreaterThan(breeze.windCount);
    expect(gale.windDuration).toBeLessThan(breeze.windDuration);
    expect(gale.cloudDuration).toBeLessThan(breeze.cloudDuration);
  });
  it("visibility and temperature change mist and lighting", () => {
    expect(
      atmosphereMetrics({ ...env.weather, visibility: 0.1 }).fog,
    ).toBeGreaterThan(0.9);
    expect(atmosphereMetrics({ ...env.weather, visibility: 20 }).fog).toBe(0);
    expect(atmosphereMetrics({ ...env.weather, temperature: 40 }).heat).toBe(1);
    expect(atmosphereMetrics({ ...env.weather, temperature: -10 }).warm).toBe(
      false,
    );
  });
  it("unavailable weather paints no fabricated weather measurements", () => {
    expect(
      atmosphereMetrics({
        ...env.weather,
        source: "unavailable",
        rain: 15,
        wind: 90,
        visibility: 0,
        temperature: 40,
      }),
    ).toMatchObject({ rainCount: 0, windCount: 0, fog: 0, heat: 0 });
  });
});
