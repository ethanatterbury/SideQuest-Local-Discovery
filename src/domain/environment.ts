import type { Environment, EnvironmentOverrides, Weather } from "./models";
import { londonParts } from "./time";
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
    result.weather.rain = o.weather.includes("rain")
      ? o.weather === "heavy-rain"
        ? 8
        : 1
      : 0;
    result.weather.wind = o.weather === "high-wind" ? 60 : 8;
    result.weather.visibility = o.weather === "fog" ? 0.3 : 10;
  }
  for (const key of ["temperature", "rain", "wind", "visibility"] as const)
    if (o[key] !== undefined) {
      result.weather[key] = o[key]!;
      result.weather.source = "simulation";
    }
  if (o.time && o.time !== "live") {
    const hours = {
      sunrise: 7,
      morning: 9,
      midday: 12,
      "golden-hour": 17,
      sunset: 18,
      evening: 20,
      midnight: 0,
    };
    const date = new Date(base.now);
    const p = londonParts(base.now);
    const delta = (hours[o.time] * 60 - p.minutes) * 60000;
    result.now = new Date(date.getTime() + delta).toISOString();
    const d = result.now.slice(0, 10);
    const offset =
      new Date(base.now).getUTCHours() === Math.floor(p.minutes / 60)
        ? "+00:00"
        : "+01:00";
    result.weather.sunrise = `${d}T07:00:00${offset}`;
    result.weather.sunset = `${d}T18:30:00${offset}`;
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
