import type { Weather } from "./models";
const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n));

/** Bounded GPU densities use measurements; labels only fill missing provider fields. */
export function atmosphereMetrics(weather: Weather) {
  const available = weather.source !== "unavailable";
  const rain =
    available &&
    weather.kind !== "snow" &&
    !(weather.snowfall && weather.snowfall > 0)
      ? clamp(weather.rain / 15)
      : 0;
  const wind = available ? clamp(weather.wind / 100) : 0;
  const snow =
    available && (weather.kind === "snow" || (weather.snowfall ?? 0) > 0);
  const fog = available ? clamp((10 - weather.visibility) / 10) : 0;
  const estimatedCloud = !available
    ? 0
    : weather.kind === "partly-cloudy"
      ? 0.45
      : ["overcast", "thunderstorm", "high-wind", "snow"].includes(
            weather.kind,
          ) || rain > 0
        ? 1
        : 0;
  return {
    rain,
    wind,
    snow,
    fog,
    cloud: available
      ? clamp((weather.cloudCover ?? estimatedCloud * 100) / 100)
      : 0,
    snowIntensity: snow
      ? clamp((weather.snowfall ?? weather.rain) / 2, 0.15, 1)
      : 0,
    direction: ((weather.windDirection ?? 225) * Math.PI) / 180,
    gust: available
      ? clamp(((weather.gusts ?? weather.wind) - weather.wind) / 60)
      : 0,
    rainCount: rain > 0 ? Math.round(38 + rain * 98) : 0,
    snowCount: snow ? Math.round(52 + clamp(weather.rain / 4) * 32) : 0,
    windCount: wind >= 0.12 ? Math.round(4 + wind * 16) : 0,
    rainDuration: 1.45 - rain * 0.66 - wind * 0.3,
    windDuration: 9 - wind * 6.6,
    cloudDuration: 68 - wind * 46,
    temperatureOpacity: available
      ? clamp(Math.abs(weather.temperature - 15) / 100, 0, 0.22)
      : 0,
    warm: weather.temperature >= 15,
    heat: available ? clamp((weather.temperature - 25) / 15) : 0,
  };
}
