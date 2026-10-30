"use client";
import { useRef, useState } from "react";
import { Clock3, ChevronDown } from "lucide-react";
import { useApp } from "./providers";
import { WEATHER_PRESETS } from "@/domain/environment";
import { fromLondonDateTime, londonDateTime } from "@/domain/planning";
import type { WeatherKind } from "@/domain/models";
import styles from "./planning-controls.module.css";

export function PlanningControls() {
  const { plan, setPlan, env, liveNow } = useApp();
  const [at, setAt] = useState(plan.at ? londonDateTime(plan.at) : "");
  const [weather, setWeather] = useState(plan.weather ?? "forecast");
  const [error, setError] = useState("");
  const details = useRef<HTMLDetailsElement>(null);
  const planned = !!(plan.at || plan.weather);
  const label = plan.at
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(plan.at))
    : "Now";
  const today = londonDateTime(liveNow).slice(0, 10);
  const last = londonDateTime(
    new Date(Date.parse(liveNow) + 6 * 86400000).toISOString(),
  ).slice(0, 10);
  return (
    <details
      className={styles.control}
      ref={details}
      onToggle={(event) => {
        if (event.currentTarget.open) {
          setAt(plan.at ? londonDateTime(plan.at) : "");
          setWeather(plan.weather ?? "forecast");
          setError("");
        }
      }}
    >
      <summary
        aria-label="Plan time and weather"
        className={planned ? styles.active : ""}
      >
        <Clock3 size={15} />
        <span>{planned ? label : "Plan for"}</span>
        <ChevronDown size={13} />
      </summary>
      <form
        className={styles.panel}
        onSubmit={(event) => {
          event.preventDefault();
          const iso = at ? fromLondonDateTime(at) : undefined;
          if (
            at &&
            (!iso || at.slice(0, 10) < today || at.slice(0, 10) > last)
          ) {
            setError("Choose a UK time within the next seven days.");
            return;
          }
          setPlan({
            ...(iso ? { at: iso } : {}),
            ...(weather !== "forecast"
              ? { weather: weather as WeatherKind }
              : {}),
          });
          if (details.current) details.current.open = false;
        }}
      >
        <strong>When are you heading out?</strong>
        <p>Matches, opening times and the map follow your plan.</p>
        <label>
          Date & time <span>UK time</span>
          <input
            aria-label="Outing date and time"
            type="datetime-local"
            min={`${today}T00:00`}
            max={`${last}T23:59`}
            value={at}
            onChange={(e) => setAt(e.target.value)}
          />
        </label>
        <button
          type="button"
          className={styles.tomorrow}
          onClick={() => {
            const tomorrow = londonDateTime(
              new Date(Date.now() + 86400000).toISOString(),
            ).slice(0, 10);
            setAt(`${tomorrow}T14:00`);
          }}
        >
          Tomorrow at 2pm
        </button>
        <label>
          Weather
          <select
            aria-label="Planning weather"
            value={weather}
            onChange={(e) => setWeather(e.target.value)}
          >
            <option value="forecast">Use the forecast</option>
            {Object.keys(WEATHER_PRESETS).map((kind) => (
              <option key={kind} value={kind}>
                {kind.replaceAll("-", " ")}
              </option>
            ))}
          </select>
        </label>
        <p>
          {weather === "forecast"
            ? "We’ll use the forecast for your chosen hour."
            : "Weather preview: you’re choosing the conditions."}
          {env.weather.source === "unavailable" &&
          planned &&
          weather === "forecast"
            ? " Forecast unavailable — try again shortly."
            : ""}
        </p>
        {error && <p role="alert">{error}</p>}
        <div className={styles.actions}>
          <button
            type="button"
            onClick={() => {
              setPlan({});
              if (details.current) details.current.open = false;
            }}
          >
            Back to now
          </button>
          <button className="button" type="submit">
            Use this plan
          </button>
        </div>
      </form>
    </details>
  );
}
