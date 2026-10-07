import { it, expect, vi, afterEach } from "vitest";
import { openMeteo, weatherKind } from "../src/providers/weather";
afterEach(() => vi.unstubAllGlobals());
it("distinguishes WMO rain showers from snow", () => {
  expect([80, 81, 82].map((c) => weatherKind(c, 10, 8))).toEqual([
    "light-rain",
    "light-rain",
    "heavy-rain",
  ]);
  expect(
    [71, 73, 75, 77, 85, 86].every((c) => weatherKind(c, 0, 8) === "snow"),
  ).toBe(true);
});
it("uses current hourly visibility and preserves zero visibility", async () => {
  for (const visibility of [500, 0]) {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            utc_offset_seconds: 3600,
            current: {
              temperature_2m: 14,
              precipitation: 0,
              weather_code: 45,
              wind_speed_10m: 9,
              time: "2026-10-07T12:30",
            },
            daily: {
              sunrise: ["2026-10-07T07:10"],
              sunset: ["2026-10-07T18:20"],
            },
            hourly: {
              time: [
                "2026-10-07T00:00",
                "2026-10-07T12:00",
                "2026-10-07T13:00",
              ],
              visibility: [10000, visibility, 9000],
            },
          }),
        ),
    );
    const weather = await openMeteo.get({
      lat: visibility === 0 ? 51.45 : 51.44,
      lng: -0.72,
    });
    expect(weather.visibility).toBe(visibility / 1000);
  }
});
it("normalizes the external weather model", async () => {
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          utc_offset_seconds: 3600,
          current: {
            temperature_2m: 14,
            precipitation: 2,
            weather_code: 61,
            wind_speed_10m: 9,
            time: "2026-10-07T12:00",
          },
          daily: {
            sunrise: ["2026-10-07T07:10"],
            sunset: ["2026-10-07T18:20"],
          },
          hourly: { time: [], visibility: [10000] },
        }),
      ),
  );
  const w = await openMeteo.get({ lat: 51.1, lng: -0.71 });
  expect(w).toMatchObject({
    source: "live",
    kind: "light-rain",
    temperature: 14,
    visibility: 10,
    sunset: "2026-10-07T18:20+01:00",
  });
});
it("degrades malformed API payloads to unavailable weather", async () => {
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          utc_offset_seconds: 3600,
          current: {
            temperature_2m: 14,
            precipitation: 2,
            weather_code: 61,
            wind_speed_10m: 9,
            time: "bad",
          },
          daily: { sunrise: ["bad"], sunset: ["bad"] },
        }),
      ),
  );
  expect((await openMeteo.get({ lat: 51.2, lng: -0.71 })).source).toBe(
    "unavailable",
  );
});
it("network failures never reject discovery", async () => {
  vi.stubGlobal("fetch", async () => {
    throw new TypeError("offline");
  });
  expect((await openMeteo.get({ lat: 51.3, lng: -0.71 })).source).toBe(
    "unavailable",
  );
});
