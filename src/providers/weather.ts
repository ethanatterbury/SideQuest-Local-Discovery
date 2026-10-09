import type { Coordinates, Weather, WeatherKind } from "@/domain/models";
import { unavailableWeather } from "@/domain/environment";
export interface WeatherProvider {
  get(coordinates: Coordinates, signal?: AbortSignal): Promise<Weather>;
}
export function weatherKind(
  code: number,
  temp: number,
  wind: number,
): WeatherKind {
  if (code >= 95) return "thunderstorm";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code === 80 || code === 81) return "light-rain";
  if (code === 82) return "heavy-rain";
  if (code >= 65) return "heavy-rain";
  if (code >= 51) return "light-rain";
  if (code >= 45) return "fog";
  if (wind >= 45) return "high-wind";
  if (temp >= 28) return "heat";
  return code === 0 ? "clear" : code <= 2 ? "partly-cloudy" : "overcast";
}
const cache = new Map<string, { at: number; weather: Weather }>();
export const openMeteo: WeatherProvider = {
  async get(c, signal) {
    const key = `${c.lat.toFixed(2)},${c.lng.toFixed(2)}`;
    const stored = cache.get(key);
    if (stored && Date.now() - stored.at < 15 * 60000)
      return { ...stored.weather, source: "cached" };
    try {
      const r = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lng}&current=temperature_2m,precipitation,weather_code,wind_speed_10m,cloud_cover,wind_direction_10m,wind_gusts_10m,snowfall&hourly=precipitation_probability,visibility&daily=sunrise,sunset&forecast_days=2&timezone=Europe%2FLondon`,
        {
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
            : AbortSignal.timeout(8000),
        },
      );
      if (!r.ok) throw Error("weather");
      const d = await r.json(),
        v = d.current;
      const offset = `${d.utc_offset_seconds >= 0 ? "+" : "-"}${String(Math.floor(Math.abs(d.utc_offset_seconds) / 3600)).padStart(2, "0")}:00`;
      if (
        !v ||
        ![
          v.temperature_2m,
          v.precipitation,
          v.wind_speed_10m,
          v.weather_code,
        ].every(Number.isFinite) ||
        !d.daily?.sunrise?.[0] ||
        !d.daily?.sunset?.[0] ||
        !Number.isFinite(d.utc_offset_seconds) ||
        ![v.time, d.daily.sunrise[0], d.daily.sunset[0]].every(
          (t) =>
            typeof t === "string" && Number.isFinite(Date.parse(t + offset)),
        ) ||
        v.temperature_2m < -80 ||
        v.temperature_2m > 65 ||
        v.precipitation < 0 ||
        v.precipitation > 100 ||
        v.wind_speed_10m < 0 ||
        v.wind_speed_10m > 300
      )
        throw Error("invalid weather");
      const now = Date.now();
      const currentTime = new Date(v.time + offset).getTime();
      const currentHour = Array.isArray(d.hourly?.time)
        ? d.hourly.time.reduce(
            (selected: number, time: string, index: number) => {
              const at = new Date(time + offset).getTime();
              return at <= currentTime &&
                (selected < 0 ||
                  at > new Date(d.hourly.time[selected] + offset).getTime())
                ? index
                : selected;
            },
            -1,
          )
        : -1;
      const visibility = d.hourly?.visibility?.[currentHour];
      const nextRain = d.hourly?.time?.findIndex(
        (t: string, i: number) =>
          new Date(t + offset).getTime() > now &&
          d.hourly.precipitation_probability[i] >= 60,
      );
      const weather: Weather = {
        kind: weatherKind(v.weather_code, v.temperature_2m, v.wind_speed_10m),
        temperature: v.temperature_2m,
        rain: v.precipitation,
        wind: v.wind_speed_10m,
        cloudCover: Number.isFinite(v.cloud_cover)
          ? Math.max(0, Math.min(100, v.cloud_cover))
          : undefined,
        windDirection: Number.isFinite(v.wind_direction_10m)
          ? ((v.wind_direction_10m % 360) + 360) % 360
          : undefined,
        gusts: Number.isFinite(v.wind_gusts_10m)
          ? Math.max(0, Math.min(300, v.wind_gusts_10m))
          : undefined,
        snowfall: Number.isFinite(v.snowfall)
          ? Math.max(0, Math.min(100, v.snowfall))
          : undefined,
        visibility:
          Number.isFinite(visibility) && visibility >= 0
            ? visibility / 1000
            : 10,
        sunrise: d.daily.sunrise[0] + offset,
        sunset: d.daily.sunset[0] + offset,
        observedAt: v.time + offset,
        source: "live",
        rainAt: nextRain >= 0 ? d.hourly.time[nextRain] + offset : undefined,
      };
      cache.set(key, { at: now, weather });
      return weather;
    } catch {
      if (stored) return { ...stored.weather, source: "cached" };
      return unavailableWeather();
    }
  },
};
