"use client";
import { useState } from "react";
import Link from "next/link";
import {
  FlaskConical,
  RotateCcw,
  ArrowUpRight,
  Map,
  Layout,
  ChevronDown,
} from "lucide-react";
import { useApp } from "@/components/providers";
import { TOWNS } from "@/providers/geocoding";
import { PLACES } from "@/providers/places";
import { rankPlaces } from "@/domain/discovery";
import { Discover } from "@/features/discover/discover";
import { LazyMap } from "@/features/map/lazy-map";
import { LocationPicker } from "@/components/location-picker";
import type {
  EnvironmentOverrides,
  WeatherKind,
  TimeKind,
  Failure,
} from "@/domain/models";
const weather: WeatherKind[] = [
  "clear",
  "sunny",
  "partly-cloudy",
  "overcast",
  "light-rain",
  "heavy-rain",
  "thunderstorm",
  "fog",
  "snow",
  "heat",
  "high-wind",
];
const times: TimeKind[] = [
  "live",
  "sunrise",
  "morning",
  "midday",
  "golden-hour",
  "sunset",
  "evening",
  "midnight",
];
const failures: { id: Failure; label: string }[] = [
  { id: "weather", label: "Weather unavailable" },
  { id: "location-denied", label: "Location permission denied" },
  { id: "location-timeout", label: "Geolocation timeout" },
  { id: "map", label: "Map provider unavailable" },
  { id: "places", label: "Places provider unavailable" },
  { id: "empty", label: "No recommendations" },
  { id: "offline", label: "Offline" },
];
export function EnvironmentLab() {
  const { env, overrides, setOverrides, query, state } = useApp();
  const [preview, setPreview] = useState<"discover" | "map">("map"),
    [locationOpen, setLocationOpen] = useState(false),
    [lat, setLat] = useState(String(env.location.lat)),
    [lng, setLng] = useState(String(env.location.lng));
  const set = (patch: Partial<EnvironmentOverrides>) =>
    setOverrides({ ...overrides, ...patch });
  const ranked = rankPlaces(PLACES, query, env, state);
  return (
    <div className="lab-page">
      <div className="lab-top">
        <div>
          <FlaskConical size={23} />
          <h1>Environment Lab</h1>
          <span>Private development tool</span>
        </div>
        <button className="button secondary" onClick={() => setOverrides({})}>
          <RotateCcw size={16} />
          Reset to live
        </button>
        <Link className="text-link" href="/">
          Open SideQuest
          <ArrowUpRight size={17} />
        </Link>
      </div>
      <div className="lab-layout">
        <aside className="lab-controls">
          <h2>Make a different day.</h2>
          <label>
            Weather
            <select
              aria-label="Weather"
              value={overrides.weather || "live"}
              onChange={(e) =>
                set({
                  weather:
                    e.target.value === "live"
                      ? undefined
                      : (e.target.value as WeatherKind),
                })
              }
            >
              <option value="live">Live</option>
              {weather.map((w) => (
                <option key={w} value={w}>
                  {w.replaceAll("-", " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            Time of day
            <select
              aria-label="Time of day"
              value={overrides.time || "live"}
              onChange={(e) => set({ time: e.target.value as TimeKind })}
            >
              {times.map((t) => (
                <option key={t} value={t}>
                  {t.replaceAll("-", " ")}
                </option>
              ))}
            </select>
          </label>
          {[
            {
              key: "temperature",
              label: "Temperature",
              min: -10,
              max: 40,
              unit: "°C",
            },
            {
              key: "rain",
              label: "Rain intensity",
              min: 0,
              max: 15,
              unit: "mm",
            },
            { key: "wind", label: "Wind", min: 0, max: 100, unit: "km/h" },
            {
              key: "visibility",
              label: "Visibility",
              min: 0.1,
              max: 20,
              unit: "km",
            },
          ].map((s) => {
            const key = s.key as "temperature" | "rain" | "wind" | "visibility";
            return (
              <label key={key}>
                {s.label}
                <output>
                  {env.weather[key].toFixed(1)} {s.unit}
                </output>
                <input
                  aria-label={s.label}
                  type="range"
                  min={s.min}
                  max={s.max}
                  step="0.1"
                  value={overrides[key] ?? env.weather[key]}
                  onChange={(e) => set({ [key]: Number(e.target.value) })}
                />
              </label>
            );
          })}
          <label>
            Starting location
            <select
              aria-label="Starting location"
              value={overrides.location?.name || "live"}
              onChange={(e) =>
                set({ location: TOWNS.find((t) => t.name === e.target.value) })
              }
            >
              <option value="live">Live / app location</option>
              {TOWNS.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <form
            className="lab-coordinates"
            onSubmit={(e) => {
              e.preventDefault();
              const latitude = Number(lat),
                longitude = Number(lng);
              if (
                Number.isFinite(latitude) &&
                Number.isFinite(longitude) &&
                Math.abs(latitude) <= 90 &&
                Math.abs(longitude) <= 180
              )
                set({
                  location: {
                    name: "Custom location",
                    lat: latitude,
                    lng: longitude,
                  },
                });
            }}
          >
            <label>
              Latitude
              <input
                type="number"
                min="-90"
                max="90"
                step="any"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                required
              />
            </label>
            <label>
              Longitude
              <input
                type="number"
                min="-180"
                max="180"
                step="any"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                required
              />
            </label>
            <button type="submit" className="button secondary">
              Set coordinates
            </button>
          </form>
          <label>
            Device preview
            <select
              aria-label="Device preview"
              value={overrides.device || "laptop"}
              onChange={(e) => set({ device: e.target.value })}
            >
              <option value="iphone">iPhone · 390px</option>
              <option value="android">Small Android · 360px</option>
              <option value="tablet">Tablet · 768px</option>
              <option value="laptop">Laptop · fluid</option>
            </select>
          </label>
          <label>
            Motion
            <select
              aria-label="Motion"
              value={
                overrides.reducedMotion === undefined
                  ? "system"
                  : overrides.reducedMotion
                    ? "reduced"
                    : "normal"
              }
              onChange={(e) =>
                set({
                  reducedMotion:
                    e.target.value === "system"
                      ? undefined
                      : e.target.value === "reduced",
                })
              }
            >
              <option value="system">System preference</option>
              <option value="normal">Normal</option>
              <option value="reduced">Reduced motion</option>
            </select>
          </label>
          <fieldset className="failure-toggles">
            <legend>Break something, gracefully.</legend>
            {failures.map((f) => (
              <label key={f.id}>
                <input
                  type="checkbox"
                  checked={env.failures.includes(f.id)}
                  onChange={(e) =>
                    set({
                      failures: e.target.checked
                        ? [...env.failures, f.id]
                        : env.failures.filter((id) => id !== f.id),
                    })
                  }
                />
                {f.label}
              </label>
            ))}
            <button className="text-link" onClick={() => setLocationOpen(true)}>
              Test location request
              <ArrowUpRight size={16} />
            </button>
          </fieldset>
          <details className="lab-debug">
            <summary>
              Recommendation reasoning
              <ChevronDown size={16} />
            </summary>
            {ranked.slice(0, 5).map((r) => (
              <div key={r.place.id}>
                <strong>
                  {r.place.name} · {r.score}
                </strong>
                {Object.entries(r.components).map(([k, v]) => (
                  <p key={k}>
                    <span>{k}</span>
                    <span>
                      {v >= 0 ? "+" : ""}
                      {v}
                    </span>
                  </p>
                ))}
              </div>
            ))}
            {!ranked.length && <p>No eligible results.</p>}
          </details>
          <details className="lab-matrix">
            <summary>Visual test matrix</summary>
            <ul>
              {[
                "Clear / midday",
                "Clear / golden hour",
                "Clear / midnight",
                "Overcast / midday",
                "Rain / daytime",
                "Rain / night",
                "Fog / morning",
                "Snow / evening",
                "Reduced motion / rain",
                "Map unavailable",
                "Weather unavailable",
                "Location denied",
                "Offline",
              ].map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </details>
        </aside>
        <section className="lab-preview-area">
          <div className="preview-tabs">
            <button
              className={preview === "map" ? "active" : ""}
              onClick={() => setPreview("map")}
            >
              <Map size={16} />
              Map atmosphere
            </button>
            <button
              className={preview === "discover" ? "active" : ""}
              onClick={() => setPreview("discover")}
            >
              <Layout size={16} />
              Discovery
            </button>
            <span>
              {env.weather.kind} · {overrides.time || "live time"} ·{" "}
              {env.location.name}
            </span>
          </div>
          <div className={`lab-preview device-${overrides.device || "laptop"}`}>
            {preview === "map" ? <LazyMap /> : <Discover />}
          </div>
        </section>
      </div>
      {locationOpen && (
        <LocationPicker onClose={() => setLocationOpen(false)} />
      )}
    </div>
  );
}
