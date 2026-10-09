"use client";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import maplibregl, {
  type GeoJSONSource,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Coordinates, Itinerary, Place } from "@/domain/models";
import type { RasterHandle, RasterStatus } from "./raster-map";
import { landscapeStyle, OPEN_MAP_STYLE, UK_MAP_BOUNDS } from "./map-style";
import styles from "./vector-map.module.css";
import type { MapCamera } from "./map-camera";
import { markerGlyph } from "./marker-glyph";
type Props = {
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
  onMove(c: Coordinates): void;
  onStatus(s: RasterStatus): void;
};
export const VectorMap = forwardRef<RasterHandle, Props>(
  function VectorMap(props, ref) {
    const root = useRef<HTMLDivElement>(null),
      map = useRef<maplibregl.Map | null>(null);
    const latest = useRef(props);
    latest.current = props;
    const [revision, setRevision] = useState(0),
      [loaded, setLoaded] = useState(0);
    useImperativeHandle(
      ref,
      () => ({
        zoomIn: () => map.current?.zoomIn(),
        zoomOut: () => map.current?.zoomOut(),
        home: () =>
          map.current?.easeTo({
            center: [latest.current.origin.lng, latest.current.origin.lat],
            zoom: 11,
            duration: latest.current.reducedMotion ? 0 : 600,
          }),
        retry: () => setRevision((n) => n + 1),
      }),
      [],
    );
    useEffect(() => {
      if (!root.current) return;
      const abort = new AbortController();
      let disposed = false;
      let instance: maplibregl.Map | undefined;
      let failed = false;
      const deadline = setTimeout(() => {
        const geography =
          instance?.isStyleLoaded() &&
          instance
            .queryRenderedFeatures()
            .some(
              (f) => !["sidequest", "sq-route", "sq-range"].includes(f.source),
            );
        latest.current.onStatus(geography ? "partial" : "unavailable");
        if (!instance) abort.abort();
      }, 10000);
      latest.current.onStatus("loading");
      async function start() {
        try {
          // Development-only deterministic renderer fixtures; production always uses OpenFreeMap.
          const fixture =
            process.env.NODE_ENV !== "production"
              ? (
                  window as Window & {
                    __SIDEQUEST_MAP_STYLE__?: StyleSpecification;
                  }
                ).__SIDEQUEST_MAP_STYLE__
              : undefined;
          const response = fixture
            ? null
            : await fetch(process.env.NEXT_PUBLIC_MAP_STYLE || OPEN_MAP_STYLE, {
                signal: AbortSignal.any([
                  abort.signal,
                  AbortSignal.timeout(9000),
                ]),
              });
          if (response && !response.ok)
            throw new Error("Map style unavailable");
          const style = landscapeStyle(fixture ?? (await response!.json()));
          if (disposed || !root.current) return;
          const m = new maplibregl.Map({
            container: root.current,
            style,
            center: [latest.current.origin.lng, latest.current.origin.lat],
            zoom: 11,
            minZoom: 4,
            maxZoom: 18,
            maxBounds: UK_MAP_BOUNDS,
            attributionControl: { compact: true },
            canvasContextAttributes: { antialias: false },
          });
          instance = m;
          map.current = m;
          m.getCanvas().setAttribute(
            "aria-label",
            "Map of nearby places. Use arrow keys to pan and plus or minus to zoom.",
          );
          const settle = () => {
            // Style load alone does not mean geography loaded. Require source tiles and a rendered geographic feature.
            if (!m.isStyleLoaded()) return;
            const hasGeography = m
              .queryRenderedFeatures()
              .some(
                (f) =>
                  !["sidequest", "sq-route", "sq-range"].includes(f.source),
              );
            if (hasGeography && m.areTilesLoaded()) {
              clearTimeout(deadline);
              latest.current.onStatus(failed ? "partial" : "ready");
            }
          };
          m.on("error", () => {
            failed = true;
          });
          let lastCamera = 0;
          const camera = () => {
            if (!m.isStyleLoaded() || performance.now() - lastCamera < 100)
              return;
            lastCamera = performance.now();
            const center = maplibregl.MercatorCoordinate.fromLngLat(
              m.getCenter(),
            );
            const water = m
              .queryRenderedFeatures()
              .filter(
                (f) =>
                  /water/.test(f.layer.id) &&
                  (f.geometry.type === "Polygon" ||
                    f.geometry.type === "MultiPolygon"),
              )
              .slice(0, 180)
              .flatMap((f) => {
                const geometry = f.geometry as
                  GeoJSON.Polygon | GeoJSON.MultiPolygon;
                const polygons =
                  geometry.type === "Polygon"
                    ? [geometry.coordinates]
                    : geometry.coordinates;
                return polygons.map((polygon) =>
                  polygon.map((ring) =>
                    ring.map((coordinate) => {
                      const p = m.project(coordinate as [number, number]);
                      return [p.x, p.y] as [number, number];
                    }),
                  ),
                );
              });
            const detail: MapCamera = {
              x: center.x,
              y: center.y,
              scale: 512 * 2 ** m.getZoom(),
              width: m.getCanvas().clientWidth,
              height: m.getCanvas().clientHeight,
              water,
            };
            root.current?.parentElement?.dispatchEvent(
              new CustomEvent("sq-camera", { detail }),
            );
          };
          m.on("move", camera);
          m.on("idle", camera);
          m.on("idle", settle);
          m.on("sourcedata", settle);
          m.on("load", () => {
            m.addSource("sidequest", {
              type: "geojson",
              data: { type: "FeatureCollection", features: [] },
              cluster: true,
              clusterRadius: 48,
              clusterMaxZoom: 13,
            });
            m.addLayer({
              id: "sq-clusters",
              type: "circle",
              source: "sidequest",
              filter: ["has", "point_count"],
              paint: {
                "circle-color": "#36543f",
                "circle-radius": [
                  "step",
                  ["get", "point_count"],
                  18,
                  20,
                  23,
                  100,
                  28,
                ],
                "circle-stroke-color": "#f6f6ef",
                "circle-stroke-width": 2,
              },
            });
            // Transparent point layer keeps source features queryable; native button markers provide keyboard access.
            m.addLayer({
              id: "sq-points",
              type: "circle",
              source: "sidequest",
              filter: ["!", ["has", "point_count"]],
              paint: { "circle-radius": 12, "circle-opacity": 0 },
            });
            m.on("click", "sq-clusters", async (e) => {
              const feature = e.features?.[0];
              if (!feature) return;
              const zoom = await (
                m.getSource("sidequest") as GeoJSONSource
              ).getClusterExpansionZoom(Number(feature.properties?.cluster_id));
              if (disposed) return;
              m.easeTo({
                center: (feature.geometry as GeoJSON.Point).coordinates as [
                  number,
                  number,
                ],
                zoom,
                duration: latest.current.reducedMotion ? 0 : 450,
              });
            });
            setLoaded((n) => n + 1);
            settle();
          });
          let userMoved = false;
          m.on("movestart", (e) => {
            if (e.originalEvent) userMoved = true;
          });
          m.on("moveend", (e) => {
            if (e.originalEvent || userMoved) {
              userMoved = false;
              const c = m.getCenter();
              latest.current.onMove({ lat: c.lat, lng: c.lng });
            }
          });
          const resize = new ResizeObserver(() => m.resize());
          resize.observe(root.current);
          m.once("remove", () => resize.disconnect());
        } catch {
          if (!disposed) latest.current.onStatus("unavailable");
        }
      }
      void start();
      return () => {
        disposed = true;
        abort.abort();
        clearTimeout(deadline);
        instance?.remove();
        map.current = null;
      };
    }, [revision]);
    useEffect(() => {
      const m = map.current,
        source = m?.getSource("sidequest") as GeoJSONSource | undefined;
      if (!m || !source) return;
      source.setData({
        type: "FeatureCollection",
        features: props.places.map((p) => ({
          type: "Feature",
          id: p.id,
          properties: { id: p.id },
          geometry: {
            type: "Point",
            coordinates: [p.coordinates.lng, p.coordinates.lat],
          },
        })),
      });
      const markers = new Map<string, maplibregl.Marker>();
      function sync() {
        if (!m) return;
        const features = m.querySourceFeatures("sidequest");
        const clusters = features.filter((f) => f.properties?.point_count);
        const visible = new Set(
          features
            .filter((f) => !f.properties?.point_count)
            .map((f) => String(f.properties?.id)),
        );
        for (const cluster of clusters)
          visible.add(`cluster-${cluster.properties?.cluster_id}`);
        if (props.selected) visible.add(props.selected.id);
        for (const [id, marker] of markers)
          if (!visible.has(id)) {
            marker.remove();
            markers.delete(id);
          }
        for (const cluster of clusters) {
          const id = `cluster-${cluster.properties?.cluster_id}`;
          if (markers.has(id)) continue;
          const button = document.createElement("button");
          button.className = styles.cluster;
          button.textContent = String(
            cluster.properties?.point_count_abbreviated,
          );
          button.setAttribute(
            "aria-label",
            `Zoom in to ${cluster.properties?.point_count} places`,
          );
          button.onclick = async () => {
            try {
              const zoom = await source!.getClusterExpansionZoom(
                Number(cluster.properties?.cluster_id),
              );
              if (!map.current) return;
              m!.easeTo({
                center: (cluster.geometry as GeoJSON.Point).coordinates as [
                  number,
                  number,
                ],
                zoom,
                duration: latest.current.reducedMotion ? 0 : 450,
              });
            } catch {
              /* A removed source cannot be expanded. */
            }
          };
          markers.set(
            id,
            new maplibregl.Marker({ element: button })
              .setLngLat(
                (cluster.geometry as GeoJSON.Point).coordinates as [
                  number,
                  number,
                ],
              )
              .addTo(m),
          );
        }
        for (const p of props.places) {
          if (!visible.has(p.id) || markers.has(p.id)) continue;
          const button = document.createElement("button");
          const selected = props.selected?.id === p.id,
            saved = props.saved.includes(p.id),
            visited = props.visited.includes(p.id);
          button.className = [
            styles.marker,
            selected ? styles.selected : "",
            saved ? styles.saved : "",
            visited ? styles.visited : "",
          ].join(" ");
          button.innerHTML = markerGlyph(p.category, saved, visited);
          button.setAttribute(
            "aria-label",
            `Select ${p.name}${saved ? ", saved" : ""}${visited ? ", visited" : ""}`,
          );
          button.setAttribute("aria-pressed", String(selected));
          button.title = p.name;
          button.onclick = () => latest.current.onSelect(p.id);
          markers.set(
            p.id,
            new maplibregl.Marker({ element: button })
              .setLngLat([p.coordinates.lng, p.coordinates.lat])
              .addTo(m),
          );
        }
      }
      m.on("idle", sync);
      m.on("moveend", sync);
      sync();
      return () => {
        m.off("idle", sync);
        m.off("moveend", sync);
        markers.forEach((marker) => marker.remove());
      };
    }, [props.places, props.selected, props.saved, props.visited, loaded]);
    useEffect(() => {
      const m = map.current;
      if (!m) return;
      m.easeTo({
        center: [props.origin.lng, props.origin.lat],
        duration: props.reducedMotion ? 0 : 500,
      });
    }, [props.origin.lat, props.origin.lng, props.reducedMotion, loaded]);
    useEffect(() => {
      const m = map.current;
      if (!m || !props.selected) return;
      m.easeTo({
        center: [
          props.selected.coordinates.lng,
          props.selected.coordinates.lat,
        ],
        duration: props.reducedMotion ? 0 : 500,
      });
    }, [props.selected, props.reducedMotion, loaded]);
    useEffect(() => {
      const m = map.current;
      if (!m?.getSource("sidequest")) return;
      const ring = Array.from({ length: 65 }, (_, i) => {
        const angle = (i * Math.PI) / 32;
        return [
          props.origin.lng +
            (Math.cos(angle) * props.radiusKm) /
              (111.32 * Math.cos((props.origin.lat * Math.PI) / 180)),
          props.origin.lat + (Math.sin(angle) * props.radiusKm) / 111.32,
        ];
      });
      const data: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { kind: "range" },
            geometry: { type: "Polygon", coordinates: [ring] },
          },
          {
            type: "Feature",
            properties: { kind: "origin" },
            geometry: {
              type: "Point",
              coordinates: [props.origin.lng, props.origin.lat],
            },
          },
        ],
      };
      if (m.getSource("sq-range"))
        (m.getSource("sq-range") as GeoJSONSource).setData(data);
      else {
        m.addSource("sq-range", { type: "geojson", data });
        m.addLayer(
          {
            id: "sq-range-fill",
            type: "fill",
            source: "sq-range",
            filter: ["==", ["get", "kind"], "range"],
            paint: { "fill-color": "#718246", "fill-opacity": 0.035 },
          },
          "sq-clusters",
        );
        m.addLayer(
          {
            id: "sq-range-line",
            type: "line",
            source: "sq-range",
            filter: ["==", ["get", "kind"], "range"],
            paint: {
              "line-color": "#718246",
              "line-width": 1,
              "line-dasharray": [4, 5],
            },
          },
          "sq-clusters",
        );
        m.addLayer({
          id: "sq-origin",
          type: "circle",
          source: "sq-range",
          filter: ["==", ["get", "kind"], "origin"],
          paint: {
            "circle-color": "#4766a1",
            "circle-radius": 7,
            "circle-stroke-width": 3,
            "circle-stroke-color": "#ffffff",
          },
        });
      }
    }, [props.origin, props.radiusKm, loaded]);
    useEffect(() => {
      const m = map.current;
      if (!m?.getSource("sidequest")) return;
      const coordinates = props.itinerary
        ? props.itinerary.stops.map((s) => [
            s.coordinates.lng,
            s.coordinates.lat,
          ])
        : props.selected
          ? [
              [props.origin.lng, props.origin.lat],
              [props.selected.coordinates.lng, props.selected.coordinates.lat],
            ]
          : [];
      const data: GeoJSON.FeatureCollection = {
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
      };
      if (m.getSource("sq-route"))
        (m.getSource("sq-route") as GeoJSONSource).setData(data);
      else {
        m.addSource("sq-route", { type: "geojson", data });
        m.addLayer({
          id: "sq-route",
          type: "line",
          source: "sq-route",
          paint: {
            "line-color": "#68815a",
            "line-width": 2,
            "line-dasharray": [3, 3],
          },
        });
      }
    }, [props.itinerary, props.selected, props.origin, loaded]);
    return (
      <div
        ref={root}
        className={styles.map}
        data-map-engine="maplibre"
        aria-hidden={props.unavailable}
        inert={props.unavailable}
      />
    );
  },
);
