import type { Weather } from "./models";
const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n));

/** Bounded CSS effects use actual measurements, rather than a weather label. */
export function atmosphereMetrics(weather: Weather) {
  const available = weather.source !== "unavailable";
  const rain =
    available && weather.kind !== "snow" ? clamp(weather.rain / 15) : 0;
  const wind = available ? clamp(weather.wind / 100) : 0;
  const snow = available && weather.kind === "snow";
  const fog = available ? clamp((10 - weather.visibility) / 10) : 0;
  const cloud = !available
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
    cloud,
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
