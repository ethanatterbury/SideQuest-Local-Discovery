"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { useApp } from "@/components/providers";
import { solarPhase } from "@/domain/time";
import { atmosphereMetrics } from "@/domain/atmosphere";
import styles from "./weather-atmosphere.module.css";

type Variables = CSSProperties & Record<`--${string}`, string | number>;
const positions = (i: number) => ({
  left: `${(i * 47.73 + 3) % 100}%`,
  top: `${(i * 31.17 + 2) % 100}%`,
});

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
  const phase = solarPhase(env.now, env.weather.sunrise, env.weather.sunset);
  const m = atmosphereMetrics(env.weather);
  const animate = !env.reducedMotion && visible;
  const night = phase === "midnight" || phase === "evening";
  const vars: Variables = {
    "--cloud-opacity": m.cloud * (kind === "thunderstorm" ? 0.46 : 0.38),
    "--cloud-duration": `${m.cloudDuration}s`,
    "--fog-opacity": m.fog * 0.43,
    "--rain-opacity": 0.52 + m.rain * 0.23,
    "--wind-opacity": 0.32 + m.wind * 0.3,
    "--wind-duration": `${m.windDuration}s`,
    "--heat-opacity": m.heat * 0.16,
    "--temperature-opacity": m.temperatureOpacity,
    "--temperature-color": m.warm ? "235, 163, 69" : "65, 126, 170",
  };
  return (
    <div
      aria-hidden="true"
      className={`weather-atmosphere ${kind} ${night ? "night" : ""} ${phase === "golden-hour" ? "golden" : ""} ${visible ? "" : "paused"} ${styles.root}`}
      data-weather={kind}
      data-time={phase}
      data-motion={env.reducedMotion ? "reduced" : "normal"}
      data-rain={env.weather.rain}
      data-wind={env.weather.wind}
      style={vars}
    >
      <div className={`${styles.light} ${styles[phase]}`} />
      <div className={styles.temperature} />
      {m.cloud > 0 && (
        <div className={`cloud-shadows ${styles.clouds}`}>
          <div
            className={`cloud-shadow cloud-shadow-near ${styles.cloud} ${styles.near}`}
          />
          <div
            className={`cloud-shadow cloud-shadow-far ${styles.cloud} ${styles.far}`}
          />
          <div className={styles.cloudVeil} />
        </div>
      )}
      {m.fog > 0 && <div className={`mist-layer ${styles.mist}`} />}
      {(kind === "clear" || kind === "sunny" || kind === "heat") && !night && (
        <div className={styles.sunlight} />
      )}
      {m.heat > 0 && <div className={styles.heat} />}
      {animate && m.windCount > 0 && (
        <div className={`wind-trails ${styles.wind}`}>
          {Array.from({ length: m.windCount }, (_, i) => (
            <i
              key={i}
              className={styles.windTrail}
              style={{
                top: `${(i * 31.17 + 2) % 100}%`,
                width: `${58 + (i % 4) * 9}%`,
                animationDelay: `${-i * 1.37}s`,
                animationDuration: `${m.windDuration + (i % 3) * 0.8}s`,
              }}
            >
              <svg viewBox="0 0 600 48" preserveAspectRatio="none">
                <path d="M0 25 C85 25 90 8 165 8 S270 40 350 28 S485 12 600 21" />
                <path d="M36 32 C104 32 115 17 175 17 S278 47 360 35 S475 20 560 29" />
              </svg>
            </i>
          ))}
        </div>
      )}
      {animate && (m.rainCount > 0 || m.snow) && (
        <div className={`weather-particles ${styles.particles}`}>
          {Array.from(
            { length: m.snow ? m.snowCount : m.rainCount },
            (_, i) => {
              const depth = i % 3;
              const particle: Variables = {
                ...positions(i),
                "--drift": `${m.wind * 150 + (i % 2 ? 22 : -22)}px`,
                "--fall": `${m.snow ? 180 + depth * 70 : 220 + depth * 75}px`,
                animationDelay: `${-i * 0.31}s`,
                animationDuration: `${m.snow ? 8 + depth * 3 - m.wind * 3 : m.rainDuration + depth * 0.15}s`,
                height: `${m.snow ? 3 + depth * 2 : 24 + m.rain * 35 + depth * 10}px`,
                width: `${m.snow ? 3 + depth * 2 : 1.5 + depth * 0.4}px`,
                opacity: m.snow ? 0.5 + depth * 0.2 : 0.4 + depth * 0.18,
              };
              return (
                <i
                  key={i}
                  className={m.snow ? styles.flake : styles.drop}
                  style={particle}
                />
              );
            },
          )}
        </div>
      )}
      {animate && m.rain > 0 && (
        <div className={`rain-ripples ${styles.ripples}`}>
          {Array.from({ length: Math.round(12 + m.rain * 22) }, (_, i) => (
            <i
              key={i}
              className={styles.ripple}
              style={{
                ...positions(i + 4),
                animationDelay: `${-i * 0.42}s`,
                animationDuration: `${2.8 - m.rain + (i % 3) * 0.35}s`,
              }}
            />
          ))}
        </div>
      )}
      {!animate && (m.rain > 0 || m.snow || m.wind > 0.2) && (
        <div
          className={`${styles.stillWeather} ${m.snow ? styles.stillSnow : m.rain > 0 ? styles.stillRain : styles.stillWind}`}
        />
      )}
      {animate && kind === "thunderstorm" && (
        <div key="storm" className={`storm-light ${styles.lightning}`}>
          <svg viewBox="0 0 1000 500" preserveAspectRatio="xMidYMin slice">
            <path d="M666 -8 L654 44 L672 68 L629 111 L639 129 L603 178 L619 203 L588 253 M630 110 L680 124 L696 159 M641 128 L590 143 L566 174" />
          </svg>
        </div>
      )}
    </div>
  );
}
