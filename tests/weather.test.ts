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
it("uses the planned hour and that day's solar times, not current conditions", async () => {
  const epoch = (value: string) => Date.parse(value) / 1000;
  const at = "2026-10-31T14:00:00Z";
  const fetcher = vi.fn(async () =>
    Response.json({
      hourly: {
        time: [epoch("2026-10-30T22:00:00Z"), epoch(at)],
        temperature_2m: [9, 19],
        precipitation: [4, 0],
        weather_code: [65, 0],
        wind_speed_10m: [20, 8],
        visibility: [6000, 20000],
        cloud_cover: [100, 5],
        wind_direction_10m: [100, 225],
        wind_gusts_10m: [30, 12],
        snowfall: [0, 0],
        precipitation_probability: [100, 0],
      },
      daily: {
        time: [epoch("2026-10-30T00:00:00Z"), epoch("2026-10-31T00:00:00Z")],
        sunrise: [epoch("2026-10-30T07:00:00Z"), epoch("2026-10-31T07:02:00Z")],
        sunset: [epoch("2026-10-30T16:30:00Z"), epoch("2026-10-31T16:28:00Z")],
      },
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  expect(
    await openMeteo.get({ lat: 52.3, lng: -1.1 }, undefined, at),
  ).toMatchObject({
    kind: "clear",
    temperature: 19,
    rain: 0,
    sunrise: "2026-10-31T07:02:00.000Z",
    sunset: "2026-10-31T16:28:00.000Z",
  });
  const request = fetcher.mock.calls[0] as unknown as [string];
  expect(String(request[0])).toContain("timeformat=unixtime");
});

it("selects the London calendar day's sun times for a plan just after midnight during BST", async () => {
  const epoch = (value: string) => Date.parse(value) / 1000;
  const at = "2027-06-10T23:30:00Z";
  vi.stubGlobal("fetch", async () =>
    Response.json({
      hourly: {
        time: [epoch("2027-06-10T23:00:00Z")],
        temperature_2m: [16],
        precipitation: [0],
        weather_code: [0],
        wind_speed_10m: [8],
      },
      daily: {
        time: [epoch("2027-06-10T00:00:00Z"), epoch("2027-06-11T00:00:00Z")],
        sunrise: [epoch("2027-06-10T03:45:00Z"), epoch("2027-06-11T03:44:00Z")],
        sunset: [epoch("2027-06-10T20:15:00Z"), epoch("2027-06-11T20:16:00Z")],
      },
    }),
  );
  expect(
    await openMeteo.get({ lat: 52.4, lng: -1.2 }, undefined, at),
  ).toMatchObject({
    sunrise: "2027-06-11T03:44:00.000Z",
    sunset: "2027-06-11T20:16:00.000Z",
  });
});
