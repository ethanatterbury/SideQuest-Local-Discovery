"use client";
import { useEffect, useState } from "react";
import { useApp } from "@/components/providers";
import { isDark } from "@/domain/time";
export function WeatherAtmosphere() {
  const { env } = useApp();
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const f = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", f);
    return () => document.removeEventListener("visibilitychange", f);
  }, []);
  const kind =
    env.weather.source === "unavailable" ? "unavailable" : env.weather.kind;
  const night = isDark(env.now, env.weather.sunrise, env.weather.sunset);
  const sunset =
    new Date(env.weather.sunset).getTime() - new Date(env.now).getTime();
  const golden = sunset > 0 && sunset < 90 * 60000;
  const particles =
    !env.reducedMotion && visible && (kind.includes("rain") || kind === "snow");
  return (
    <div
      aria-hidden="true"
      className={`weather-atmosphere ${kind} ${night ? "night" : golden ? "golden" : ""} ${visible ? "" : "paused"}`}
    >
      <div className="atmosphere-wash" />
      {kind === "fog" && <div className="mist-layer" />}
      {particles && (
        <div className="weather-particles">
          {Array.from({ length: kind === "heavy-rain" ? 24 : 12 }, (_, i) => (
            <i
              key={i}
              style={{
                left: `${(i * 47) % 100}%`,
                top: `${(i * 31) % 100}%`,
                animationDelay: `${-i * 0.34}s`,
                animationDuration: `${kind === "snow" ? 5 + (i % 3) : 1.5 + (i % 3) * 0.6}s`,
                opacity: 0.1 + (i % 3) * 0.04,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
