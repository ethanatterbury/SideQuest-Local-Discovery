import type { Environment, EnvironmentOverrides, Weather } from "./models";
import { londonParts, solarPreset } from "./time";
export function unavailableWeather(now = new Date().toISOString()): Weather {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
  const localHour = Math.floor(londonParts(now).minutes / 60);
  const offset =
    localHour === new Date(now).getUTCHours() ? "+00:00" : "+01:00";
  return {
    kind: "overcast",
    temperature: 0,
    rain: 0,
    wind: 0,
    visibility: 10,
    sunrise: `${date}T08:00:00${offset}`,
    sunset: `${date}T16:00:00${offset}`,
    observedAt: now,
    source: "unavailable",
  };
}
/** Each selection starts from a coherent day; sliders can then vary it. */
export const WEATHER_PRESETS = {
  clear: { temperature: 17, rain: 0, wind: 5, visibility: 20 },
  sunny: { temperature: 23, rain: 0, wind: 7, visibility: 20 },
  "partly-cloudy": { temperature: 16, rain: 0, wind: 14, visibility: 15 },
  overcast: { temperature: 12, rain: 0, wind: 18, visibility: 10 },
  "light-rain": { temperature: 11, rain: 1.2, wind: 15, visibility: 8 },
  "heavy-rain": { temperature: 9, rain: 9, wind: 32, visibility: 4 },
  thunderstorm: { temperature: 18, rain: 12, wind: 48, visibility: 3 },
  fog: { temperature: 7, rain: 0, wind: 3, visibility: 0.3 },
  snow: { temperature: -2, rain: 0.8, wind: 12, visibility: 3 },
  heat: { temperature: 35, rain: 0, wind: 4, visibility: 12 },
  "high-wind": { temperature: 13, rain: 0, wind: 68, visibility: 12 },
} satisfies Record<
  import("./models").WeatherKind,
  Pick<Weather, "temperature" | "rain" | "wind" | "visibility">
>;

export function applyOverrides(
  base: Environment,
  o: EnvironmentOverrides,
): Environment {
  const result = {
    ...base,
    location: o.location || base.location,
    reducedMotion: o.reducedMotion ?? base.reducedMotion,
    failures: o.failures ?? base.failures,
    weather: { ...base.weather },
  };
  if (o.weather) {
    result.weather.kind = o.weather;
    result.weather.source = "simulation";
    Object.assign(result.weather, WEATHER_PRESETS[o.weather], {
      cloudCover: ["clear", "sunny", "heat"].includes(o.weather)
        ? 5
        : o.weather === "partly-cloudy"
          ? 45
          : o.weather === "thunderstorm"
            ? 100
            : 95,
      windDirection: 225,
      gusts: WEATHER_PRESETS[o.weather].wind * 1.4,
      snowfall: o.weather === "snow" ? 0.8 : 0,
    });
  }
  for (const key of [
    "temperature",
    "rain",
    "wind",
    "visibility",
    "cloudCover",
    "windDirection",
    "gusts",
    "snowfall",
  ] as const)
    if (o[key] !== undefined) {
      result.weather[key] = o[key]!;
      result.weather.source = "simulation";
    }
  if (o.time && o.time !== "live") {
    result.now = solarPreset(
      o.time,
      base.now,
      base.weather.sunrise,
      base.weather.sunset,
    );
  }
  if (
    result.failures.includes("weather") ||
    result.failures.includes("offline")
  )
    result.weather.source = "unavailable";
  return result;
}
export function contextualHeadline(env: Environment) {
  const { day, minutes } = londonParts(env.now);
  if (env.weather.source !== "unavailable" && env.weather.rain > 0)
    return ["A little rain.", "Still plenty to do."];
  if (day === 5 && minutes > 1020)
    return ["Friday’s not over.", "Go make a night of it."];
  if (day === 0 && minutes > 720) return ["One more thing", "before Monday."];
  if (minutes >= 1200 || minutes < 360)
    return ["A change of scene.", "Even after dark."];
  return ["Less scrolling.", "More going somewhere."];
}
