"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Coordinates, Itinerary, Place } from "@/domain/models";

export type RasterHandle = { zoomIn(): void; zoomOut(): void; home(): void };
export const RasterMap = forwardRef<
  RasterHandle,
  {
    places: Place[];
    origin: Coordinates;
    selected?: Place;
    saved: string[];
    itinerary?: Itinerary;
    radiusKm: number;
    night: boolean;
    onSelect(id: string): void;
    onMove(center: Coordinates): void;
    onAvailable(value: boolean): void;
  }
>(function RasterMap(
  {
    places,
    origin,
    selected,
    saved,
    itinerary,
    radiusKm,
    night,
    onSelect,
    onMove,
    onAvailable,
  },
  ref,
) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const callbacks = useRef({ onSelect, onMove, onAvailable });
  callbacks.current = { onSelect, onMove, onAvailable };
  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => {
        map.current?.zoomIn();
      },
      zoomOut: () => {
        map.current?.zoomOut();
      },
      home: () => {
        map.current?.setView([origin.lat, origin.lng], 11);
      },
    }),
    [origin],
  );
  useEffect(() => {
    if (!element.current) return;
    const m = L.map(element.current, {
      zoomControl: false,
      preferCanvas: false,
    }).setView([origin.lat, origin.lng], 11);
    map.current = m;
    let available = false;
    const tiles = L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        keepBuffer: 1,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      },
    ).addTo(m);
    tiles.on("tileload", () => {
      available = true;
      callbacks.current.onAvailable(true);
    });
    const timer = setTimeout(() => {
      if (!available) callbacks.current.onAvailable(false);
    }, 12000);
    m.on("dragend", () => {
      const c = m.getCenter();
      callbacks.current.onMove({ lat: c.lat, lng: c.lng });
    });
    const resize = new ResizeObserver(() => m.invalidateSize({ pan: false }));
    resize.observe(element.current);
    return () => {
      clearTimeout(timer);
      resize.disconnect();
      m.remove();
      map.current = null;
    };
    // Camera and points update independently; weather controls never recreate the renderer.
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
    for (const p of places) {
      const label = document.createElement("span");
      label.textContent = p.name;
      L.circleMarker([p.coordinates.lat, p.coordinates.lng], {
        radius: selected?.id === p.id ? 12 : 8,
        color: "#fff",
        weight: 3,
        fillColor: saved.includes(p.id) ? "#bed653" : "#243b30",
        fillOpacity: 1,
      })
        .addTo(group)
        .bindTooltip(label, { direction: "top" })
        .on("click", () => callbacks.current.onSelect(p.id));
    }
    const points: L.LatLngExpression[] = itinerary
      ? itinerary.stops.map((s) => [s.coordinates.lat, s.coordinates.lng])
      : selected
        ? [
            [origin.lat, origin.lng],
            [selected.coordinates.lat, selected.coordinates.lng],
          ]
        : [];
    if (points.length > 1)
      L.polyline(points, {
        color: "#566a38",
        weight: 3,
        dashArray: "7 7",
      }).addTo(group);
    return () => {
      m.removeLayer(group);
    };
  }, [places, origin, selected, saved, itinerary, radiusKm]);
  const selectedLat = selected?.coordinates.lat;
  const selectedLng = selected?.coordinates.lng;
  useEffect(() => {
    map.current?.panTo(
      selectedLat !== undefined && selectedLng !== undefined
        ? [selectedLat, selectedLng]
        : [origin.lat, origin.lng],
      { animate: false },
    );
  }, [selected?.id, selectedLat, selectedLng, origin.lat, origin.lng]);
  return (
    <div
      ref={element}
      className={`raster-map ${night ? "raster-night" : ""}`}
      aria-label="Street map of nearby places"
      data-map-engine="leaflet"
    />
  );
});
