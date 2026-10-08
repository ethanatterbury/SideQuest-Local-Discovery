"use client";
import { useEffect, useRef, useState, useMemo } from "react";
import Link from "next/link";
import {
  Plus,
  Minus,
  LocateFixed,
  Layers,
  ArrowUpRight,
  ChevronUp,
  ChevronDown,
  Map as MapIcon,
} from "lucide-react";
import { useApp } from "@/components/providers";
import { matchesActivity, rankPlaces } from "@/domain/discovery";
import { PlaceCard } from "@/features/discover/place-card";
import { PlaceImage } from "@/components/primitives";
import { Refinement } from "@/features/discover/refinement";
import { WeatherAtmosphere } from "./weather-atmosphere";
import { isMapFoodPlace } from "./map-food";
import { isDark } from "@/domain/time";
import { directionsUrl } from "@/providers/routing";
import type { Coordinates, Itinerary, Place } from "@/domain/models";
import { RasterMap, type RasterHandle, type RasterStatus } from "./raster-map";
export function MapView({ itinerary }: { itinerary?: Itinerary }) {
  const { places: catalog, env, query, state, setLocation } = useApp();
  const [includeFood, setIncludeFood] = useState(false);
  const ranked = useMemo(
    () =>
      rankPlaces(catalog, { ...query, activity: "any" }, env, state).filter(
        ({ place }) =>
          isMapFoodPlace(place)
            ? includeFood
            : matchesActivity(
                place,
                query.activity === "food" ? "any" : query.activity,
              ),
      ),
    [catalog, query, env, state, includeFood],
  );
  const [selectedId, setSelectedId] = useState(""),
    [rasterStatus, setRasterStatus] = useState<RasterStatus>("loading"),
    [moved, setMoved] = useState(false),
    [sheetOpen, setSheetOpen] = useState(false);
  const [center, setCenter] = useState<Coordinates>(env.location);
  const raster = useRef<RasterHandle>(null);
  const [linkedPlaceId, setLinkedPlaceId] = useState("");
  const selectedPlace = catalog.find((place) => place.id === selectedId);
  const selectionAllowed =
    !selectedPlace ||
    !isMapFoodPlace(selectedPlace) ||
    includeFood ||
    linkedPlaceId === selectedId;
  const selected =
    selectedId && selectionAllowed
      ? ranked.find((r) => r.place.id === selectedId)
      : ranked[0];
  const activePlace =
    (selectionAllowed ? selectedPlace : undefined) || selected?.place;
  const urlSelectionHandled = useRef(false);
  useEffect(() => {
    if (urlSelectionHandled.current) return;
    if (selectedId) {
      urlSelectionHandled.current = true;
      return;
    }
    const id = new URLSearchParams(window.location.search).get("place");
    if (!id) urlSelectionHandled.current = true;
    else if (catalog.some((p) => p.id === id)) {
      urlSelectionHandled.current = true;
      setLinkedPlaceId(id);
      setSelectedId(id);
    }
  }, [catalog, selectedId]);
  const failure = env.failures.includes("map");
  const visible = useMemo(() => {
    const eligible = ranked.map((r) => r.place);
    return [
      ...eligible,
      ...catalog.filter(
        (p) =>
          state.saved.includes(p.id) ||
          state.visits.some((v) => v.id === p.id) ||
          (p.id === selectedId && p.id === linkedPlaceId),
      ),
    ].filter(
      (p, i, a) =>
        a.findIndex((x) => x.id === p.id) === i &&
        (includeFood ||
          !isMapFoodPlace(p) ||
          (p.id === selectedId && p.id === linkedPlaceId)),
    );
  }, [catalog, ranked, state, includeFood, selectedId, linkedPlaceId]);
  const night = isDark(env.now, env.weather.sunrise, env.weather.sunset);
  const unavailable = failure || rasterStatus === "unavailable";
  const startTouch = useRef(0);
  function swipe(end: number) {
    const delta = end - startTouch.current;
    if (Math.abs(delta) < 40) return;
    const index = ranked.findIndex((r) => r.place.id === selected?.place.id);
    setSelectedId(
      ranked[(index + (delta < 0 ? 1 : -1) + ranked.length) % ranked.length]
        ?.place.id || "",
    );
  }
  return (
    <div className="map-page">
      <aside className={`map-sidebar ${sheetOpen ? "expanded" : ""}`}>
        <button
          className="sheet-handle"
          aria-label={sheetOpen ? "Collapse results" : "Expand results"}
          onClick={() => setSheetOpen(!sheetOpen)}
        >
          {sheetOpen ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
        </button>
        <div className="map-sidebar-heading">
          <h1>
            Your kind
            <br />
            of nearby.
          </h1>
          <p>One good place beats a hundred pins.</p>
          <Refinement
            mapFood={{ included: includeFood, onChange: setIncludeFood }}
          />
        </div>
        <div className="map-results">
          {ranked.slice(0, 5).map((r) => (
            <button
              key={r.place.id}
              className={`map-result-row ${selected?.place.id === r.place.id ? "selected" : ""}`}
              onClick={() => setSelectedId(r.place.id)}
            >
              <span className="map-result-score">{r.score}</span>
              <span>
                <strong>{r.place.name}</strong>
                <small>
                  ~{r.travel} min ·{" "}
                  {r.place.cost === 0 ? "Free entry" : "Check admission"}
                </small>
              </span>
              <ArrowUpRight size={17} />
            </button>
          ))}
          {!ranked.length && (
            <p className="notice">
              No suitable results. Try more time or a wider travel range.
            </p>
          )}
        </div>
        {activePlace && (
          <div
            className="map-selected"
            onTouchStart={(e) => {
              startTouch.current = e.touches[0].clientX;
            }}
            onTouchEnd={(e) => swipe(e.changedTouches[0].clientX)}
          >
            {selected ? (
              <PlaceCard item={selected} compact />
            ) : (
              <div className="map-ineligible">
                <PlaceImage place={activePlace} />
                <div>
                  <h2>{activePlace.name}</h2>
                  <p>
                    {!includeFood && isMapFoodPlace(activePlace)
                      ? "Food & coffee is hidden from map results. Enable it to include this place."
                      : "Saved for another day. This place doesn’t fit the current conditions or preferences."}
                  </p>
                </div>
              </div>
            )}
            <div className="map-selected-actions">
              <Link href={`/place/${activePlace.id}`}>
                See the plan <ArrowUpRight size={16} />
              </Link>
              <a
                href={directionsUrl(activePlace.coordinates)}
                target="_blank"
                rel="noreferrer"
              >
                Directions
              </a>
            </div>
          </div>
        )}
      </aside>
      <div className="map-canvas-wrap">
        {!failure && (
          <RasterMap
            ref={raster}
            places={visible}
            origin={env.location}
            selected={activePlace}
            saved={state.saved}
            visited={state.visits.map((visit) => visit.id)}
            itinerary={itinerary}
            radiusKm={
              query.travel * (query.travelMode === "walk" ? 0.06 : 0.45)
            }
            night={night}
            unavailable={rasterStatus === "unavailable"}
            reducedMotion={env.reducedMotion}
            onSelect={setSelectedId}
            onMove={(c) => {
              setCenter(c);
              setMoved(true);
            }}
            onStatus={setRasterStatus}
          />
        )}
        {unavailable && (
          <GeographicFallback
            items={visible.map((place) => ({
              place,
              score: ranked.find((r) => r.place.id === place.id)?.score ?? null,
            }))}
            origin={env.location}
            selected={activePlace}
            onSelect={setSelectedId}
            onRetry={failure ? undefined : () => raster.current?.retry()}
          />
        )}
        <WeatherAtmosphere />
        <div className="map-status" role="status">
          <Layers size={15} />
          {unavailable
            ? "Location overview · map unavailable"
            : rasterStatus === "ready"
              ? "Street map · your next detour"
              : rasterStatus === "partial"
                ? "Street map · some tiles unavailable"
                : "Opening the map…"}
        </div>
        <div className="map-controls">
          <button
            aria-label="Zoom in"
            onClick={() => raster.current?.zoomIn()}
            disabled={unavailable}
          >
            <Plus size={20} />
          </button>
          <button
            aria-label="Zoom out"
            onClick={() => raster.current?.zoomOut()}
            disabled={unavailable}
          >
            <Minus size={20} />
          </button>
          <button
            aria-label="Return to starting location"
            disabled={unavailable}
            onClick={() => {
              raster.current?.home();
              setMoved(false);
            }}
          >
            <LocateFixed size={19} />
          </button>
        </div>
        {moved && !unavailable && (
          <button
            className="button search-area"
            onClick={() => {
              setLocation({ ...center, name: "Map area" });
              setMoved(false);
            }}
          >
            Search this area
          </button>
        )}
        <div className="map-legend">
          <span className="origin-dot" />
          Starting point
          <span className="place-dot" />
          Suggested
          <span className="route-dash" />
          Estimated journey
        </div>
      </div>
    </div>
  );
}
function GeographicFallback({
  items,
  origin,
  selected,
  onSelect,
  onRetry,
}: {
  items: { place: Place; score: number | null }[];
  origin: Coordinates;
  selected?: Place;
  onSelect: (id: string) => void;
  onRetry?: () => void;
}) {
  const all = [origin, ...items.map((r) => r.place.coordinates)];
  const latMin = Math.min(...all.map((c) => c.lat)) - 0.035,
    latMax = Math.max(...all.map((c) => c.lat)) + 0.035,
    lngMin = Math.min(...all.map((c) => c.lng)) - 0.06,
    lngMax = Math.max(...all.map((c) => c.lng)) + 0.06;
  const xy = (c: Coordinates) => ({
    x: 12 + ((c.lng - lngMin) / (lngMax - lngMin)) * 76,
    y: 88 - ((c.lat - latMin) / (latMax - latMin)) * 76,
  });
  const point = xy(origin);
  return (
    <div className="geographic-fallback">
      <div className="fallback-map-heading">
        <MapIcon size={25} />
        <h2>
          The map can wait.
          <br />
          The day doesn’t have to.
        </h2>
        <p>
          Locations plotted by coordinates. Roads and live routes are
          unavailable.
        </p>
        {onRetry && (
          <button className="button secondary" onClick={onRetry}>
            Retry street map
          </button>
        )}
      </div>
      <div className="coordinate-plot">
        {selected && (
          <svg
            className="fallback-route"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              d={`M${point.x} ${point.y}L${xy(selected.coordinates).x} ${xy(selected.coordinates).y}`}
              stroke="#68815a"
              strokeWidth=".3"
              strokeDasharray="1 1"
            />
          </svg>
        )}
        <span
          className="plot-origin"
          style={{ left: `${point.x}%`, top: `${point.y}%` }}
        >
          You
        </span>
        {items.slice(0, 10).map((r) => {
          const p = xy(r.place.coordinates);
          return (
            <button
              key={r.place.id}
              className={`plot-place ${selected?.id === r.place.id ? "selected" : ""}`}
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
              onClick={() => onSelect(r.place.id)}
              aria-label={`Select ${r.place.name}`}
            >
              <span>{r.score ?? <MapIcon size={12} />}</span>
              <strong>{r.place.name}</strong>
            </button>
          );
        })}
        <span className="plot-axis">{latMax.toFixed(2)}° N</span>
        <span className="plot-axis bottom">
          {lngMin.toFixed(2)}° → {lngMax.toFixed(2)}°
        </span>
      </div>
    </div>
  );
}
