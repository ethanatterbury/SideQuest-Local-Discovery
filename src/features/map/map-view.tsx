"use client";
import { useEffect, useRef, useState, useMemo } from "react";
import Link from "next/link";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
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
import { rankPlaces } from "@/domain/discovery";
import { PlaceCard } from "@/features/discover/place-card";
import { PlaceImage } from "@/components/primitives";
import { Refinement } from "@/features/discover/refinement";
import { WeatherAtmosphere } from "./weather-atmosphere";
import { isDark } from "@/domain/time";
import { directionsUrl } from "@/providers/routing";
import type { Coordinates, Itinerary, Place } from "@/domain/models";
import { RasterMap, type RasterHandle } from "./raster-map";
function circle(center: Coordinates, km: number) {
  return Array.from({ length: 65 }, (_, i) => {
    const angle = (i / 64) * Math.PI * 2;
    return [
      center.lng +
        (km / 111 / Math.cos((center.lat * Math.PI) / 180)) * Math.cos(angle),
      center.lat + (km / 111) * Math.sin(angle),
    ];
  });
}
export function MapView({ itinerary }: { itinerary?: Itinerary }) {
  const { places: catalog, env, query, state, setLocation } = useApp();
  const ranked = useMemo(
    () => rankPlaces(catalog, query, env, state),
    [catalog, query, env, state],
  );
  const [selectedId, setSelectedId] = useState(""),
    [failed, setFailed] = useState(false),
    [loaded, setLoaded] = useState(false),
    [moved, setMoved] = useState(false),
    [sheetOpen, setSheetOpen] = useState(false);
  const [center, setCenter] = useState<Coordinates>(env.location);
  const raster = useRef<RasterHandle>(null);
  const [rasterAvailable, setRasterAvailable] = useState(true);
  const container = useRef<HTMLDivElement>(null),
    map = useRef<maplibregl.Map | null>(null),
    originMarker = useRef<maplibregl.Marker | null>(null);
  const originalPaint = useRef(new Map<string, Record<string, unknown>>());
  const selected = selectedId
    ? ranked.find((r) => r.place.id === selectedId)
    : ranked[0];
  const activePlace =
    catalog.find((p) => p.id === selectedId) || selected?.place;
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
          state.saved.includes(p.id) || state.visits.some((v) => v.id === p.id),
      ),
    ].filter((p, i, a) => a.findIndex((x) => x.id === p.id) === i);
  }, [catalog, ranked, state]);
  useEffect(() => {
    if (failure) {
      setFailed(true);
      return;
    }
    if (!container.current) return;
    let m: maplibregl.Map;
    let timer: ReturnType<typeof setTimeout>;
    try {
      m = new maplibregl.Map({
        container: container.current,
        style:
          process.env.NEXT_PUBLIC_MAP_STYLE ||
          "https://tiles.openfreemap.org/styles/positron",
        center: [env.location.lng, env.location.lat],
        zoom: 10.5,
        attributionControl: { compact: true },
        maxPitch: 30,
      });
      map.current = m;
      m.on("load", () => {
        clearTimeout(timer);
        setLoaded(true);
        setFailed(false);
        m.addSource("places", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
          cluster: true,
          clusterMaxZoom: 11,
          clusterRadius: 45,
        });
        m.addLayer({
          id: "clusters",
          type: "circle",
          source: "places",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": "#243b30",
            "circle-radius": 19,
            "circle-stroke-color": "#f6f6ef",
            "circle-stroke-width": 3,
          },
        });
        m.addLayer({
          id: "cluster-count",
          type: "symbol",
          source: "places",
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-font": ["Noto Sans Regular"],
            "text-size": 12,
          },
          paint: { "text-color": "#ffffff" },
        });
        m.addLayer({
          id: "points",
          type: "circle",
          source: "places",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": ["case", ["get", "saved"], "#d9eb84", "#243b30"],
            "circle-radius": ["case", ["get", "selected"], 13, 10],
            "circle-stroke-color": [
              "case",
              ["get", "visited"],
              "#d9eb84",
              "#ffffff",
            ],
            "circle-stroke-width": 3,
          },
        });
        m.addLayer({
          id: "labels",
          type: "symbol",
          source: "places",
          filter: ["!", ["has", "point_count"]],
          layout: {
            "text-field": ["get", "name"],
            "text-font": ["Noto Sans Regular"],
            "text-size": 11,
            "text-offset": [0, 1.7],
            "text-anchor": "top",
            "text-max-width": 12,
          },
          paint: {
            "text-color": "#243b30",
            "text-halo-color": "#ffffff",
            "text-halo-width": 2,
          },
        });
        m.addSource("radius", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        m.addLayer(
          {
            id: "radius-fill",
            type: "fill",
            source: "radius",
            paint: { "fill-color": "#b4c58f", "fill-opacity": 0.08 },
          },
          "clusters",
        );
        m.addLayer(
          {
            id: "radius-line",
            type: "line",
            source: "radius",
            paint: {
              "line-color": "#657c50",
              "line-opacity": 0.4,
              "line-width": 1,
              "line-dasharray": [3, 3],
            },
          },
          "clusters",
        );
        m.addSource("route", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        m.addLayer({
          id: "route-line",
          type: "line",
          source: "route",
          paint: {
            "line-color": "#68815a",
            "line-width": 3,
            "line-dasharray": [2, 2],
          },
        });
        const el = document.createElement("div");
        el.className = "origin-marker";
        el.setAttribute("aria-label", "Starting location");
        originMarker.current = new maplibregl.Marker({ element: el })
          .setLngLat([env.location.lng, env.location.lat])
          .addTo(m);
        m.on("click", "points", (e) => {
          const id = e.features?.[0]?.properties?.id;
          if (id) setSelectedId(id);
        });
        m.on("click", "clusters", async (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const source = m.getSource("places") as maplibregl.GeoJSONSource;
          const zoom = await source.getClusterExpansionZoom(
            Number(f.properties?.cluster_id),
          );
          if (f.geometry.type === "Point")
            m.easeTo({
              center: f.geometry.coordinates as [number, number],
              zoom,
            });
        });
        m.on("mouseenter", "points", () => {
          m.getCanvas().style.cursor = "pointer";
        });
        m.on("mouseleave", "points", () => {
          m.getCanvas().style.cursor = "";
        });
        m.on("moveend", (e) => {
          if (e.originalEvent) {
            setMoved(true);
            const c = m.getCenter();
            setCenter({ lat: c.lat, lng: c.lng });
          }
        });
      });
      m.on("error", () => {
        if (!m.isStyleLoaded()) setFailed(true);
      });
      timer = setTimeout(() => {
        if (!m.isStyleLoaded()) setFailed(true);
      }, 12000);
    } catch {
      setFailed(true);
      return;
    }
    return () => {
      clearTimeout(timer);
      m.remove();
      map.current = null;
      setLoaded(false);
    }; // Camera changes belong to separate effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failure]);
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    const source = m.getSource("places") as
      maplibregl.GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: visible.map((p) => ({
        type: "Feature",
        properties: {
          id: p.id,
          name: p.name,
          saved: state.saved.includes(p.id),
          selected: p.id === activePlace?.id,
          visited: state.visits.some((v) => v.id === p.id),
        },
        geometry: {
          type: "Point",
          coordinates: [p.coordinates.lng, p.coordinates.lat],
        },
      })),
    });
    const radius = m.getSource("radius") as
      maplibregl.GeoJSONSource | undefined;
    radius?.setData({
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [circle(env.location, (query.travel * 40) / 60 / 1.35)],
      },
    });
  }, [
    visible,
    state.saved,
    state.visits,
    env.location,
    query.travel,
    loaded,
    activePlace?.id,
  ]);
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    const coordinates = itinerary
      ? itinerary.stops.map((s) => [s.coordinates.lng, s.coordinates.lat])
      : activePlace
        ? [
            [env.location.lng, env.location.lat],
            [activePlace.coordinates.lng, activePlace.coordinates.lat],
          ]
        : [];
    const source = m.getSource("route") as maplibregl.GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features:
        coordinates.length > 1
          ? [
              {
                type: "Feature",
                properties: {},
                geometry: { type: "LineString", coordinates },
              },
            ]
          : [],
    });
  }, [
    activePlace?.id,
    env.location,
    loaded,
    itinerary,
    env.reducedMotion,
    activePlace,
  ]);
  const activeLat = activePlace?.coordinates.lat;
  const activeLng = activePlace?.coordinates.lng;
  useEffect(() => {
    if (activeLat !== undefined && activeLng !== undefined && loaded)
      map.current?.easeTo({
        center: [activeLng, activeLat],
        duration: env.reducedMotion ? 0 : 800,
        zoom: 11,
      });
  }, [activePlace?.id, activeLat, activeLng, loaded, env.reducedMotion]);
  useEffect(() => {
    originMarker.current?.setLngLat([env.location.lng, env.location.lat]);
    map.current?.easeTo({
      center: [env.location.lng, env.location.lat],
      duration: env.reducedMotion ? 0 : 600,
    });
  }, [env.location, env.reducedMotion]);
  const night = isDark(env.now, env.weather.sunrise, env.weather.sunset);
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    for (const layer of m.getStyle().layers) {
      if (
        [
          "clusters",
          "points",
          "labels",
          "cluster-count",
          "route-line",
          "radius-fill",
          "radius-line",
        ].includes(layer.id)
      )
        continue;
      const property =
        layer.type === "background"
          ? "background-color"
          : layer.type === "fill"
            ? "fill-color"
            : layer.type === "line"
              ? "line-color"
              : layer.type === "symbol"
                ? "text-color"
                : null;
      if (!property) continue;
      if (!originalPaint.current.has(layer.id))
        originalPaint.current.set(layer.id, {
          [property]: m.getPaintProperty(layer.id, property),
          halo:
            layer.type === "symbol"
              ? m.getPaintProperty(layer.id, "text-halo-color")
              : undefined,
        });
      const original = originalPaint.current.get(layer.id)?.[property];
      if (original === undefined) continue;
      const color =
        layer.type === "symbol"
          ? "#bdcbb9"
          : layer.id.includes("water")
            ? "#1b3540"
            : layer.type === "line"
              ? "#3b5149"
              : layer.id.includes("park") || layer.id.includes("wood")
                ? "#293e31"
                : "#263a35";
      try {
        m.setPaintProperty(layer.id, property + "-transition", {
          duration: env.reducedMotion ? 0 : 1600,
        });
        m.setPaintProperty(layer.id, property, night ? color : original);
        if (layer.type === "symbol") {
          m.setPaintProperty(
            layer.id,
            "text-halo-color",
            night
              ? "#20332e"
              : originalPaint.current.get(layer.id)?.halo || "transparent",
          );
        }
      } catch {}
    }
  }, [night, loaded, env.reducedMotion]);
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
          <Refinement />
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
                    Saved for another day. This place doesn’t fit the current
                    conditions or preferences.
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
        <div
          ref={container}
          className={`map-canvas ${failed ? "map-hidden" : ""}`}
          aria-label="Interactive map of nearby places"
        />
        {failed && !failure && (
          <RasterMap
            ref={raster}
            places={visible}
            origin={env.location}
            selected={activePlace}
            saved={state.saved}
            itinerary={itinerary}
            radiusKm={
              query.travel * (query.travelMode === "walk" ? 0.06 : 0.45)
            }
            night={night}
            onSelect={setSelectedId}
            onMove={(c) => {
              setCenter(c);
              setMoved(true);
            }}
            onAvailable={setRasterAvailable}
          />
        )}
        {failed && (failure || !rasterAvailable) && (
          <GeographicFallback
            items={visible.map((place) => ({
              place,
              score: ranked.find((r) => r.place.id === place.id)?.score ?? null,
            }))}
            origin={env.location}
            selected={activePlace}
            onSelect={setSelectedId}
          />
        )}
        <WeatherAtmosphere />
        <div className="map-status">
          <Layers size={15} />
          {failed
            ? !failure && rasterAvailable
              ? "Street map · your next detour"
              : "Location overview · map unavailable"
            : loaded
              ? "Your next detour"
              : "Opening the map…"}
        </div>
        <div className="map-controls">
          <button
            aria-label="Zoom in"
            onClick={() =>
              failed ? raster.current?.zoomIn() : map.current?.zoomIn()
            }
            disabled={failure || (failed && !rasterAvailable)}
          >
            <Plus size={20} />
          </button>
          <button
            aria-label="Zoom out"
            onClick={() =>
              failed ? raster.current?.zoomOut() : map.current?.zoomOut()
            }
            disabled={failure || (failed && !rasterAvailable)}
          >
            <Minus size={20} />
          </button>
          <button
            aria-label="Return to starting location"
            onClick={() => {
              if (failed) raster.current?.home();
              map.current?.easeTo({
                center: [env.location.lng, env.location.lat],
                zoom: 10.5,
              });
              setMoved(false);
            }}
          >
            <LocateFixed size={19} />
          </button>
        </div>
        {moved && (!failed || (!failure && rasterAvailable)) && (
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
}: {
  items: { place: Place; score: number | null }[];
  origin: Coordinates;
  selected?: Place;
  onSelect: (id: string) => void;
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
