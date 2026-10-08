"use client";
import { useEffect, useState } from "react";
import { useApp } from "@/components/providers";
import { isDark } from "@/domain/time";

export function WeatherAtmosphere() {
  const { env } = useApp();
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const kind =
    env.weather.source === "unavailable" ? "unavailable" : env.weather.kind;
  const night = isDark(env.now, env.weather.sunrise, env.weather.sunset);
  const sunset =
    new Date(env.weather.sunset).getTime() - new Date(env.now).getTime();
  const golden = sunset > 0 && sunset < 90 * 60000;
  const rain = kind.includes("rain");
  const cloudy = kind === "overcast" || kind === "partly-cloudy" || rain;
  const particles = !env.reducedMotion && visible && (rain || kind === "snow");
  return (
    <div
      aria-hidden="true"
      className={`weather-atmosphere ${kind} ${night ? "night" : golden ? "golden" : ""} ${visible ? "" : "paused"}`}
    >
      <div className="atmosphere-wash" />
      {cloudy && (
        <div className="cloud-shadows">
          <div className="cloud-shadow cloud-shadow-near" />
          <div className="cloud-shadow cloud-shadow-far" />
        </div>
      )}
      {kind === "fog" && <div className="mist-layer" />}
      {particles && (
        <div className="weather-particles">
          {Array.from({ length: kind === "heavy-rain" ? 24 : 12 }, (_, i) => (
            <i
              key={i}
              style={{
                left: `${(i * 47 + 7) % 100}%`,
                top: `${(i * 31 + 3) % 100}%`,
                animationDelay: `${-i * 0.37}s`,
                animationDuration: `${kind === "snow" ? 5 + (i % 3) : 1.15 + (i % 4) * 0.23}s`,
                height: kind === "snow" ? undefined : `${14 + (i % 3) * 4}px`,
                opacity:
                  kind === "snow"
                    ? 0.3 + (i % 3) * 0.08
                    : 0.24 + (i % 3) * 0.07,
              }}
            />
          ))}
        </div>
      )}
      {particles && rain && (
        <div className="rain-ripples">
          {Array.from({ length: 4 }, (_, i) => (
            <i
              key={i}
              style={{
                left: `${16 + i * 23}%`,
                top: `${38 + ((i * 17) % 48)}%`,
                animationDelay: `${-i * 1.1}s`,
                animationDuration: `${3.7 + (i % 2) * 0.8}s`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
