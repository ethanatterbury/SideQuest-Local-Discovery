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
  Bookmark,
  Car,
  Footprints,
  X,
} from "lucide-react";
import { useApp } from "@/components/providers";
import { matchesActivity, rankPlaces } from "@/domain/discovery";
import { isChildOuting } from "@/domain/venue-suitability";
import { PlaceImage } from "@/components/primitives";
import { Refinement } from "@/features/discover/refinement";
import { WeatherAtmosphere } from "./weather-atmosphere";
import { isMapFoodPlace } from "./map-food";
import { isDark } from "@/domain/time";
import { directionsUrl, estimatedRouting } from "@/providers/routing";
import { track } from "@/providers/analytics";
import type { Coordinates, Itinerary, Place } from "@/domain/models";
import { RasterMap, type RasterHandle, type RasterStatus } from "./raster-map";
import styles from "./map-selection.module.css";
export function MapView({ itinerary }: { itinerary?: Itinerary }) {
  const {
    places: catalog,
    env,
    query,
    state,
    setLocation,
    update,
    toast,
  } = useApp();
  const [includeFood, setIncludeFood] = useState(false);
  const ranked = useMemo(
    () =>
      rankPlaces(catalog, { ...query, activity: "any" }, env, state).filter(
        ({ place }) =>
          isMapFoodPlace(place)
            ? includeFood
            : (query.intent !== "kids" || isChildOuting(place)) &&
              matchesActivity(
                place,
                query.activity === "food" ? "any" : query.activity,
              ),
      ),
    [catalog, query, env, state, includeFood],
  );
  const [selectedId, setSelectedId] = useState(""),
    [rasterStatus, setRasterStatus] = useState<RasterStatus>("loading"),
    [moved, setMoved] = useState(false),
    [sheetOpen, setSheetOpen] = useState(false),
    [selectionCleared, setSelectionCleared] = useState(false);
  const [center, setCenter] = useState<Coordinates>(env.location);
  const raster = useRef<RasterHandle>(null);
  const page = useRef<HTMLDivElement>(null);
  const selectionTrigger = useRef<HTMLElement | null>(null);
  const [linkedPlaceId, setLinkedPlaceId] = useState("");
  const selectedPlace = catalog.find((place) => place.id === selectedId);
  const selectionAllowed =
    !selectedPlace ||
    !isMapFoodPlace(selectedPlace) ||
    includeFood ||
    linkedPlaceId === selectedId;
  const selected = selectionCleared
    ? undefined
    : selectedId && selectionAllowed
      ? ranked.find((r) => r.place.id === selectedId)
      : ranked[0];
  const activePlace = !selectionCleared
    ? (selectionAllowed ? selectedPlace : undefined) || selected?.place
    : undefined;
  function selectPlace(id: string) {
    const focused = document.activeElement;
    selectionTrigger.current =
      focused instanceof HTMLElement && focused.matches("button, a, [tabindex]")
        ? focused
        : null;
    setSelectionCleared(false);
    setSelectedId(id);
    setSheetOpen(false);
  }
  function clearSelection() {
    setSelectionCleared(true);
    setSelectedId("");
    setLinkedPlaceId("");
    const trigger = selectionTrigger.current;
    requestAnimationFrame(() => {
      if (trigger?.isConnected && trigger.getClientRects().length)
        trigger.focus({ preventScroll: true });
      else
        page.current
          ?.querySelector<HTMLElement>(
            '[data-map-engine="leaflet"], .sheet-handle',
          )
          ?.focus({ preventScroll: true });
    });
  }
  useEffect(() => {
    const root = page.current;
    if (!root || root.closest(".lab-preview")) return;
    const fit = () => {
      const top = root.getBoundingClientRect().top + window.scrollY;
      const navigation = window.matchMedia("(max-width: 700px)").matches
        ? 68
        : 0;
      root.style.setProperty(
        "--map-height",
        `${Math.max(300, window.innerHeight - top - navigation)}px`,
      );
    };
    fit();
    const observer = new ResizeObserver(fit);
    document
      .querySelectorAll(".header, .context-bar, .connection-notice")
      .forEach((element) => observer.observe(element));
    window.addEventListener("resize", fit);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);
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
  const saved = !!activePlace && state.saved.includes(activePlace.id);
  const travel = activePlace
    ? (selected?.travel ??
      estimatedRouting.estimate(
        env.location,
        activePlace.coordinates,
        query.travelMode,
      ).minutes)
    : 0;
  function savePlace() {
    if (!activePlace) return;
    update((current) => ({
      ...current,
      saved: saved
        ? current.saved.filter((id) => id !== activePlace.id)
        : [...current.saved, activePlace.id],
    }));
    if (!saved) track("place_saved", { id: activePlace.id });
    toast(
      saved ? "Taken off your list." : "Saved for a day that needs a plan.",
    );
  }
  return (
    <div ref={page} className={`map-page ${styles.page}`}>
      <aside
        className={`map-sidebar ${styles.sidebar} ${sheetOpen ? `expanded ${styles.expanded}` : ""}`}
        aria-label="Nearby places"
      >
        <button
          className="sheet-handle"
          aria-label={sheetOpen ? "Collapse results" : "Expand results"}
          aria-expanded={sheetOpen}
          aria-controls="map-browse-content"
          onClick={() => setSheetOpen(!sheetOpen)}
        >
          {sheetOpen ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          <span>
            {sheetOpen ? "Back to map" : `Browse nearby · ${ranked.length}`}
          </span>
        </button>
        <div id="map-browse-content" className={styles.browseContent}>
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
                aria-pressed={activePlace?.id === r.place.id}
                onClick={() => selectPlace(r.place.id)}
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
        </div>
      </aside>
      <div className={`map-canvas-wrap ${styles.canvas}`}>
        <span className={styles.selectionStatus} role="status">
          {activePlace ? `Selected ${activePlace.name}` : "No place selected"}
        </span>
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
            onSelect={selectPlace}
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
            onSelect={selectPlace}
            onRetry={failure ? undefined : () => raster.current?.retry()}
          />
        )}
        <WeatherAtmosphere />
        {activePlace && (
          <article
            className={`map-selected ${styles.selection}`}
            aria-label={`Selected place: ${activePlace.name}`}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                clearSelection();
              }
            }}
          >
            <div className={styles.photo}>
              <PlaceImage key={activePlace.id} place={activePlace} priority />
            </div>
            <button
              className={styles.close}
              aria-label="Close selected place"
              onClick={clearSelection}
            >
              <X size={18} />
            </button>
            <div className={styles.details}>
              <p className={styles.category}>{activePlace.category}</p>
              <h2>{activePlace.name}</h2>
              <div className={styles.meta}>
                {selected && (
                  <span className={styles.match}>{selected.score}% match</span>
                )}
                <span>
                  {query.travelMode === "walk" ? (
                    <Footprints size={14} />
                  ) : (
                    <Car size={14} />
                  )}{" "}
                  ~{travel} min {query.travelMode === "walk" ? "walk" : "drive"}
                </span>
                <span>
                  {activePlace.cost === 0
                    ? "Free entry"
                    : activePlace.costLabel}
                </span>
              </div>
              {!selected && (
                <p className={styles.notice}>
                  {!includeFood && isMapFoodPlace(activePlace)
                    ? "Food & coffee is hidden from map results. Enable it to include this place."
                    : "This place doesn’t fit the current conditions or preferences."}
                </p>
              )}
              <div className={styles.actions}>
                <button
                  onClick={savePlace}
                  aria-label={
                    saved
                      ? `Unsave ${activePlace.name}`
                      : `Save ${activePlace.name}`
                  }
                  aria-pressed={saved}
                >
                  <Bookmark size={17} fill={saved ? "currentColor" : "none"} />
                  <span>{saved ? "Saved" : "Save"}</span>
                </button>
                <Link href={`/place/${activePlace.id}`}>
                  See the plan <ArrowUpRight size={16} />
                </Link>
                <a
                  href={directionsUrl(activePlace.coordinates)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Directions <ArrowUpRight size={14} />
                </a>
              </div>
            </div>
          </article>
        )}
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
