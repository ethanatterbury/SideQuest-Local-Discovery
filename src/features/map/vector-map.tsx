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
import {
  landscapeStyle,
  OPEN_MAP_STYLE,
  UK_MAP_BOUNDS,
  SATELLITE_SOURCE,
  RASTER_FALLBACK_STYLE,
  type Basemap,
} from "./map-style";
import styles from "./vector-map.module.css";
import type { MapCamera } from "./map-camera";
import { markerGlyph } from "./marker-glyph";
import { mapPixelRatio } from "./render-budget";
type Props = {
  basemap?: Basemap;
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
  onBasemapError?(): void;
};
export const VectorMap = forwardRef<RasterHandle, Props>(
  function VectorMap(props, ref) {
    const root = useRef<HTMLDivElement>(null),
      map = useRef<maplibregl.Map | null>(null);
    const markerCache = useRef(new Map<string, maplibregl.Marker>());
    const sourceSignature = useRef("");
    const cameraMemory = useRef<{
      center: [number, number];
      zoom: number;
    } | null>(null);
    const originMemory = useRef("");
    const selectionMemory = useRef("");
    const satelliteFailed = useRef(false);
    const baseStyle = useRef<{
      original: StyleSpecification;
      landscape: StyleSpecification;
      visibility?: Map<string, unknown>;
    } | null>(null);
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
      const cachedMarkers = markerCache.current;
      const abort = new AbortController();
      let disposed = false;
      let instance: maplibregl.Map | undefined;
      let failed = false;
      let fallbackUsed = false;
      let rasterDecoded = false;
      const checkDeadline = () => {
        if (disposed || document.hidden) return;
        const geography =
          instance?.isStyleLoaded() &&
          (rasterDecoded ||
            instance
              .queryRenderedFeatures()
              .some(
                (f) =>
                  !["sidequest", "sq-route", "sq-range"].includes(f.source),
              ));
        if (!geography && instance && !fallbackUsed) {
          fallbackUsed = true;
          failed = false;
          rasterDecoded = false;
          baseStyle.current = {
            original: RASTER_FALLBACK_STYLE,
            landscape: RASTER_FALLBACK_STYLE,
            visibility: new Map([["sq-base-raster", "visible"]]),
          };
          latest.current.onStatus("loading");
          instance.setStyle(RASTER_FALLBACK_STYLE);
          deadline = setTimeout(checkDeadline, 12000);
          return;
        }
        latest.current.onStatus(geography ? "partial" : "unavailable");
        if (!instance) abort.abort();
      };
      let deadline = setTimeout(checkDeadline, 10000);
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
          let original: StyleSpecification;
          try {
            const response = fixture
              ? null
              : await fetch(
                  process.env.NEXT_PUBLIC_MAP_STYLE || OPEN_MAP_STYLE,
                  {
                    signal: AbortSignal.any([
                      abort.signal,
                      AbortSignal.timeout(9000),
                    ]),
                  },
                );
            if (response && !response.ok)
              throw new Error("Map style unavailable");
            original = fixture ?? (await response!.json());
          } catch {
            if (abort.signal.aborted) throw Error("Map load cancelled");
            original = RASTER_FALLBACK_STYLE;
            fallbackUsed = true;
          }
          const style = landscapeStyle(original);
          baseStyle.current = {
            original,
            landscape: style,
            visibility: new Map(
              style.layers.map((layer) => [
                layer.id,
                layer.layout?.visibility ?? "visible",
              ]),
            ),
          };
          if (disposed || !root.current) return;
          const m = new maplibregl.Map({
            container: root.current,
            style,
            center: cameraMemory.current?.center ?? [
              latest.current.origin.lng,
              latest.current.origin.lat,
            ],
            zoom: cameraMemory.current?.zoom ?? 11,
            minZoom: 4,
            maxZoom: 18,
            maxBounds: UK_MAP_BOUNDS,
            attributionControl: {
              compact: true,
              customAttribution:
                'Places: <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Geoapify</a>',
            },
            canvasContextAttributes: { antialias: false },
            pixelRatio: mapPixelRatio(
              root.current.clientWidth,
              root.current.clientHeight,
              window.devicePixelRatio,
            ),
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
            const hasGeography =
              rasterDecoded ||
              m
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
          m.on("error", (event) => {
            if (
              (event as typeof event & { sourceId?: string }).sourceId ===
              "sq-satellite"
            ) {
              if (!satelliteFailed.current) {
                satelliteFailed.current = true;
                latest.current.onBasemapError?.();
              }
              return;
            }
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
            const waterLayers = m
              .getStyle()
              .layers.filter(
                (layer) => layer.type === "fill" && /water/.test(layer.id),
              )
              .map((layer) => layer.id);
            const water = (
              waterLayers.length
                ? m.queryRenderedFeatures({ layers: waterLayers })
                : []
            )
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
          m.on("moveend", camera);
          m.on("idle", camera);
          m.on("idle", settle);
          m.on("sourcedata", (event) => {
            if (
              event.sourceId === "sq-base-raster" &&
              event.tile?.state === "loaded"
            )
              rasterDecoded = true;
            settle();
          });
          const expandCluster = async (e: maplibregl.MapLayerMouseEvent) => {
            const feature = e.features?.[0];
            if (!feature) return;
            if (!m.style) return;
            const source = m.getSource("sidequest") as
              GeoJSONSource | undefined;
            if (!source) return;
            const zoom = await source.getClusterExpansionZoom(
              Number(feature.properties?.cluster_id),
            );
            if (!disposed)
              m.easeTo({
                center: (feature.geometry as GeoJSON.Point).coordinates as [
                  number,
                  number,
                ],
                zoom,
                duration: latest.current.reducedMotion ? 0 : 450,
              });
          };
          m.on("click", "sq-clusters", expandCluster);
          m.on("style.load", () => {
            rasterDecoded = false;
            cachedMarkers.forEach((marker) => marker.remove());
            cachedMarkers.clear();
            sourceSignature.current = "";
            if (!m.getSource("sidequest"))
              m.addSource("sidequest", {
                type: "geojson",
                data: { type: "FeatureCollection", features: [] },
                cluster: true,
                clusterRadius: 48,
                clusterMaxZoom: 13,
              });
            if (!m.getLayer("sq-clusters"))
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
            if (!m.getLayer("sq-points"))
              m.addLayer({
                id: "sq-points",
                type: "circle",
                source: "sidequest",
                filter: ["!", ["has", "point_count"]],
                paint: { "circle-radius": 12, "circle-opacity": 0 },
              });
            setLoaded((n) => n + 1);
            settle();
          });
          let userMoved = false;
          m.on("movestart", (e) => {
            if (e.originalEvent) userMoved = true;
          });
          m.on("moveend", (e) => {
            const position = m.getCenter();
            cameraMemory.current = {
              center: [position.lng, position.lat],
              zoom: m.getZoom(),
            };
            if (e.originalEvent || userMoved) {
              userMoved = false;
              const c = m.getCenter();
              latest.current.onMove({ lat: c.lat, lng: c.lng });
            }
          });
          const resize = new ResizeObserver(() => {
            if (root.current)
              m.setPixelRatio(
                mapPixelRatio(
                  root.current.clientWidth,
                  root.current.clientHeight,
                  window.devicePixelRatio,
                ),
              );
            m.resize();
          });
          resize.observe(root.current);
          const resume = () => {
            if (document.hidden || disposed) return;
            m.resize();
            m.triggerRepaint();
            settle();
            clearTimeout(deadline);
            deadline = setTimeout(checkDeadline, 10000);
          };
          document.addEventListener("visibilitychange", resume);
          window.addEventListener("online", resume);
          m.on("webglcontextlost", () => latest.current.onStatus("loading"));
          m.on("webglcontextrestored", resume);
          m.once("remove", () => {
            resize.disconnect();
            document.removeEventListener("visibilitychange", resume);
            window.removeEventListener("online", resume);
          });
        } catch {
          if (!disposed) latest.current.onStatus("unavailable");
        }
      }
      void start();
      return () => {
        disposed = true;
        abort.abort();
        clearTimeout(deadline);
        cachedMarkers.forEach((marker) => marker.remove());
        cachedMarkers.clear();
        sourceSignature.current = "";
        instance?.remove();
        map.current = null;
      };
    }, [revision]);
    useEffect(() => {
      const m = map.current,
        base = baseStyle.current;
      if (!m?.style || !loaded || !base) return;
      const mode = props.basemap ?? "landscape";
      if (
        mode === "satellite" &&
        satelliteFailed.current &&
        m.getSource("sq-satellite")
      ) {
        m.removeLayer("sq-satellite");
        m.removeSource("sq-satellite");
        satelliteFailed.current = false;
      }
      if (mode === "satellite" && !m.getSource("sq-satellite")) {
        m.addSource("sq-satellite", SATELLITE_SOURCE);
        m.addLayer(
          { id: "sq-satellite", type: "raster", source: "sq-satellite" },
          m.getStyle().layers[0]?.id,
        );
      }
      if (m.getLayer("sq-satellite"))
        m.setLayoutProperty(
          "sq-satellite",
          "visibility",
          mode === "satellite" ? "visible" : "none",
        );
      for (let i = 0; i < base.original.layers.length; i++) {
        const original = base.original.layers[i];
        if (!m.getLayer(original.id)) continue;
        m.setLayoutProperty(
          original.id,
          "visibility",
          mode === "satellite" && original.type !== "symbol"
            ? "none"
            : (base.visibility?.get(original.id) ?? "visible"),
        );
      }
    }, [props.basemap, loaded]);
    useEffect(() => {
      const m = map.current;
      // MapLibre clears its style during WebGL loss. Props may still change
      // while restoration is pending; wait for style.load to rebuild sources.
      if (!m?.style) return;
      const source = m.getSource("sidequest") as GeoJSONSource | undefined;
      if (!source) return;
      const signature =
        `${loaded}:` +
        props.places
          .map((p) => `${p.id}:${p.coordinates.lat}:${p.coordinates.lng}`)
          .join("|");
      if (signature !== sourceSignature.current) {
        sourceSignature.current = signature;
        for (const [id, marker] of markerCache.current)
          if (id.startsWith("cluster-")) {
            marker.remove();
            markerCache.current.delete(id);
          }
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
      }
      const markers = markerCache.current;
      const byId = new Map(props.places.map((place) => [place.id, place]));
      const savedIds = new Set(props.saved),
        visitedIds = new Set(props.visited);
      function sync() {
        if (!m?.style) return;
        const bounds = m.getBounds();
        const features = m
          .querySourceFeatures("sidequest")
          .filter(
            (feature) =>
              feature.geometry.type === "Point" &&
              bounds.contains(
                (feature.geometry as GeoJSON.Point).coordinates as [
                  number,
                  number,
                ],
              ),
          );
        const clusters = [
          ...new Map(
            features
              .filter((f) => f.properties?.point_count)
              .map((f) => [f.properties?.cluster_id, f]),
          ).values(),
        ];
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
          const existingCluster = markers.get(id);
          const button =
            existingCluster?.getElement() || document.createElement("button");
          // MapLibre owns positioning/state classes on this cached element.
          button.classList.add(styles.cluster);
          const count = String(cluster.properties?.point_count_abbreviated);
          if (button.textContent !== count) button.textContent = count;
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
          if (existingCluster) {
            const [lng, lat] = (cluster.geometry as GeoJSON.Point).coordinates;
            const position = existingCluster.getLngLat();
            if (position.lng !== lng || position.lat !== lat)
              existingCluster.setLngLat([lng, lat]);
            continue;
          }
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
        for (const id of visible) {
          const p = byId.get(id);
          if (!p) continue;
          const existingMarker = markers.get(p.id);
          const button =
            existingMarker?.getElement() || document.createElement("button");
          const selected = props.selected?.id === p.id,
            saved = savedIds.has(p.id),
            visited = visitedIds.has(p.id);
          const presentation = `${p.name}|${p.category}|${selected}|${saved}|${visited}`;
          if (button.dataset.presentation !== presentation) {
            button.dataset.presentation = presentation;
            button.classList.add(styles.marker);
            button.classList.toggle(styles.selected, selected);
            button.classList.toggle(styles.saved, saved);
            button.classList.toggle(styles.visited, visited);
            const glyph = markerGlyph(p.category, saved, visited);
            if (button.innerHTML !== glyph) button.innerHTML = glyph;
            button.setAttribute(
              "aria-label",
              `Select ${p.name}${saved ? ", saved" : ""}${visited ? ", visited" : ""}`,
            );
            button.setAttribute("aria-pressed", String(selected));
            button.title = p.name;
            button.onclick = () => latest.current.onSelect(p.id);
          }
          if (existingMarker) {
            const position = existingMarker.getLngLat();
            if (
              position.lng !== p.coordinates.lng ||
              position.lat !== p.coordinates.lat
            )
              existingMarker.setLngLat([p.coordinates.lng, p.coordinates.lat]);
            continue;
          }
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
      };
    }, [props.places, props.selected, props.saved, props.visited, loaded]);
    useEffect(() => {
      const m = map.current;
      const key = `${props.origin.lat},${props.origin.lng}`;
      if (!m || !loaded || originMemory.current === key) return;
      originMemory.current = key;
      m.easeTo({
        center: [props.origin.lng, props.origin.lat],
        duration: props.reducedMotion ? 0 : 500,
      });
    }, [props.origin.lat, props.origin.lng, props.reducedMotion, loaded]);
    const selectedId = props.selected?.id,
      selectedLat = props.selected?.coordinates.lat,
      selectedLng = props.selected?.coordinates.lng;
    useEffect(() => {
      const m = map.current;
      const key = `${selectedId},${selectedLat},${selectedLng}`;
      if (selectionMemory.current === key) return;
      if (
        !m ||
        !loaded ||
        !selectedId ||
        selectedLat === undefined ||
        selectedLng === undefined
      ) {
        if (!selectedId) selectionMemory.current = "";
        return;
      }
      selectionMemory.current = key;
      m.easeTo({
        center: [selectedLng, selectedLat],
        duration: props.reducedMotion ? 0 : 500,
      });
    }, [selectedId, selectedLat, selectedLng, props.reducedMotion, loaded]);
    useEffect(() => {
      const m = map.current;
      if (!m?.style || !m.getSource("sidequest")) return;
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
      if (!m?.style || !m.getSource("sidequest")) return;
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
