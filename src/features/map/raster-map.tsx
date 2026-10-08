"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Coordinates, Itinerary, Place } from "@/domain/models";

export type RasterStatus = "loading" | "ready" | "partial" | "unavailable";
export type RasterHandle = {
  zoomIn(): void;
  zoomOut(): void;
  home(): void;
  retry(): void;
};
export const RasterMap = forwardRef<
  RasterHandle,
  {
    places: Place[];
    origin: Coordinates;
    selected?: Place;
    saved: string[];
    visited: string[];
    itinerary?: Itinerary;
    radiusKm: number;
    night: boolean;
    unavailable: boolean;
    reducedMotion: boolean;
    onSelect(id: string): void;
    onMove(center: Coordinates): void;
    onStatus(value: RasterStatus): void;
  }
>(function RasterMap(
  {
    places,
    origin,
    selected,
    saved,
    visited,
    itinerary,
    radiusKm,
    night,
    unavailable,
    reducedMotion,
    onSelect,
    onMove,
    onStatus,
  },
  ref,
) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const tiles = useRef<L.TileLayer | null>(null);
  const markers = useRef(new Map<string, L.Marker>());
  const callbacks = useRef({ onSelect, onMove, onStatus });
  callbacks.current = { onSelect, onMove, onStatus };
  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => map.current?.zoomIn(),
      zoomOut: () => map.current?.zoomOut(),
      home: () =>
        map.current?.setView([origin.lat, origin.lng], 11, {
          animate: !reducedMotion,
        }),
      retry: () => tiles.current?.redraw(),
    }),
    [origin.lat, origin.lng, reducedMotion],
  );

  useEffect(() => {
    const root = element.current;
    if (!root) return;
    let m: L.Map;
    try {
      m = L.map(root, { zoomControl: false, preferCanvas: false }).setView(
        [origin.lat, origin.lng],
        11,
      );
    } catch {
      callbacks.current.onStatus("unavailable");
      return;
    }
    map.current = m;
    const ownedMarkers = markers.current;
    // Browser image requests retain the provider's cache headers. Only viewport
    // tiles are requested: no prefetch, offline tile packs, or cache bypass.
    const layer = L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        keepBuffer: 0,
        updateWhenIdle: true,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      },
    );
    tiles.current = layer;
    let timer: ReturnType<typeof setTimeout>;
    let disposed = false;
    function health(settled: boolean) {
      if (disposed) return;
      const bounds = root!.getBoundingClientRect();
      const visible = Array.from(
        root!.querySelectorAll<HTMLImageElement>(".leaflet-tile"),
      ).filter((tile) => {
        const rect = tile.getBoundingClientRect();
        return (
          rect.right > bounds.left &&
          rect.left < bounds.right &&
          rect.bottom > bounds.top &&
          rect.top < bounds.bottom
        );
      });
      const decoded = visible.filter(
        (tile) =>
          tile.complete && tile.naturalWidth > 0 && tile.naturalHeight > 0,
      ).length;
      // A loaded renderer/style is not evidence of geography. Check decoded,
      // visible images, including after the user moves into a failed tile area.
      const status: RasterStatus =
        visible.length > 0 && decoded === visible.length
          ? "ready"
          : settled
            ? decoded > 0
              ? "partial"
              : "unavailable"
            : "loading";
      callbacks.current.onStatus(status);
    }
    function loading() {
      clearTimeout(timer);
      callbacks.current.onStatus("loading");
      timer = setTimeout(() => health(true), 12000);
    }
    layer.on("loading", loading);
    layer.on("load", () => {
      clearTimeout(timer);
      health(true);
    });
    layer.on("tileload", () => health(false));
    loading();
    layer.addTo(m);
    let userMove = false;
    m.on("dragstart", () => {
      userMove = true;
    });
    // Leaflet keyboard panning emits move events but no drag event.
    const keyboardMove = (event: KeyboardEvent) => {
      if (
        event.target === root &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      )
        userMove = true;
    };
    root.addEventListener("keydown", keyboardMove);
    m.on("moveend", () => {
      if (!userMove) return;
      userMove = false;
      const c = m.getCenter();
      callbacks.current.onMove({ lat: c.lat, lng: c.lng });
    });
    const resize = new ResizeObserver(() => m.invalidateSize({ pan: false }));
    resize.observe(root);
    return () => {
      disposed = true;
      clearTimeout(timer);
      root.removeEventListener("keydown", keyboardMove);
      resize.disconnect();
      ownedMarkers.clear();
      m.remove();
      map.current = null;
      tiles.current = null;
    };
    // Camera and points update independently; photos/weather do not recreate the renderer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const group = L.layerGroup().addTo(m);
    L.circle([origin.lat, origin.lng], {
      radius: radiusKm * 1000,
      color: "#718246",
      fillOpacity: 0.05,
      weight: 1,
      dashArray: "5 6",
      interactive: false,
    }).addTo(group);
    L.circleMarker([origin.lat, origin.lng], {
      radius: 7,
      color: "#ffffff",
      weight: 3,
      fillColor: "#4766a1",
      fillOpacity: 1,
    })
      .addTo(group)
      .bindTooltip("Starting location");
    return () => {
      m.removeLayer(group);
    };
  }, [origin.lat, origin.lng, radiusKm]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const ids = new Set(places.map((place) => place.id));
    for (const [id, marker] of markers.current) {
      if (!ids.has(id)) {
        m.removeLayer(marker);
        markers.current.delete(id);
      }
    }
    for (const place of places) {
      let marker = markers.current.get(place.id);
      if (!marker) {
        const dot = document.createElement("span");
        dot.className = "map-place-dot";
        dot.setAttribute("aria-hidden", "true");
        marker = L.marker([place.coordinates.lat, place.coordinates.lng], {
          icon: L.divIcon({
            className: "map-place-marker",
            html: dot,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
          }),
          keyboard: true,
          autoPanOnFocus: false,
        }).addTo(m);
        const label = document.createElement("span");
        label.textContent = place.name;
        marker.bindTooltip(label, { direction: "top", offset: [0, -10] });
        marker.on("click", () => callbacks.current.onSelect(place.id));
        marker.getElement()?.addEventListener("keydown", (event) => {
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            callbacks.current.onSelect(place.id);
          }
        });
        markers.current.set(place.id, marker);
      }
      marker.setLatLng([place.coordinates.lat, place.coordinates.lng]);
      const icon = marker.getElement();
      const isSaved = saved.includes(place.id),
        isVisited = visited.includes(place.id),
        isSelected = selected?.id === place.id;
      icon?.classList.toggle("map-place-saved", isSaved);
      icon?.classList.toggle("map-place-visited", isVisited);
      icon?.classList.toggle("map-place-selected", isSelected);
      icon?.setAttribute(
        "aria-label",
        `Select ${place.name}${isSaved ? " · saved" : ""}${isVisited ? " · visited" : ""}`,
      );
      icon?.setAttribute("aria-pressed", String(isSelected));
      marker.setZIndexOffset(isSelected ? 1000 : 0);
    }
  }, [places, selected?.id, saved, visited]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const points: L.LatLngExpression[] = itinerary
      ? itinerary.stops.map((stop) => [
          stop.coordinates.lat,
          stop.coordinates.lng,
        ])
      : selected
        ? [
            [origin.lat, origin.lng],
            [selected.coordinates.lat, selected.coordinates.lng],
          ]
        : [];
    if (points.length < 2) return;
    const line = L.polyline(points, {
      color: "#566a38",
      weight: 3,
      dashArray: "7 7",
      interactive: false,
    }).addTo(m);
    return () => {
      m.removeLayer(line);
    };
  }, [itinerary, selected, origin.lat, origin.lng]);

  useEffect(() => {
    map.current?.panTo([origin.lat, origin.lng], { animate: false });
  }, [origin.lat, origin.lng]);
  const selectedLat = selected?.coordinates.lat,
    selectedLng = selected?.coordinates.lng;
  useEffect(() => {
    if (selectedLat !== undefined && selectedLng !== undefined)
      map.current?.panTo([selectedLat, selectedLng], { animate: false });
  }, [selected?.id, selectedLat, selectedLng]);

  return (
    <div
      ref={element}
      className={`raster-map ${night ? "raster-night" : ""} ${unavailable ? "raster-unavailable" : ""}`}
      aria-hidden={unavailable}
      inert={unavailable}
      aria-label="Street map of nearby places"
      data-map-engine="leaflet"
    />
  );
});
