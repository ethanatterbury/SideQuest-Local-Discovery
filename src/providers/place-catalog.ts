"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DiscoveryQuery,
  Environment,
  LocalState,
  Place,
  Coordinates,
} from "@/domain/models";
import { PLACES } from "./places";
import { nearbyCells, cellId, inUK } from "@/domain/geo-cells";
import { LOAD_BUDGET } from "@/domain/performance";
import { readArea, writeArea } from "./area-storage";
import { seedVenueImage, withSeedPhoto } from "./seed-venue-media";
import { distanceKm } from "./routing";

export type CatalogStatus = "loading" | "live" | "cached" | "fallback";
const KEY = "sidequest:places:v1";
export function revalidateStoredPhotos(stored: Place[]): Place[] {
  return stored.map((place) => ({
    ...place,
    image:
      PLACES.find((seed) => seed.id === place.id)?.image ||
      seedVenueImage({ ...place, image: undefined }) ||
      undefined,
  }));
}
function isPlace(value: unknown): value is Place {
  if (!value || typeof value !== "object") return false;
  const p = value as Place;
  return (
    typeof p.id === "string" &&
    typeof p.name === "string" &&
    typeof p.category === "string" &&
    typeof p.website === "string" &&
    Array.isArray(p.intents) &&
    Array.isArray(p.company) &&
    Array.isArray(p.notes) &&
    Array.isArray(p.duration) &&
    p.duration.length === 2 &&
    p.duration.every(Number.isFinite) &&
    !!p.coordinates &&
    Number.isFinite(p.coordinates.lat) &&
    Math.abs(p.coordinates.lat) <= 90 &&
    Number.isFinite(p.coordinates.lng) &&
    Math.abs(p.coordinates.lng) <= 180 &&
    ["indoor", "outdoor", "mixed"].includes(p.environment) &&
    (p.cost === null || Number.isFinite(p.cost))
  );
}
const normalized = (s: string) =>
  s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
export function mergeCatalog(
  existing: Place[],
  incoming: Place[],
  pinned: ReadonlySet<string> = new Set(),
  origin?: Coordinates,
): Place[] {
  const merged = new Map(existing.map((p) => [p.id, p]));
  const byName = new Map<string, Set<string>>();
  const index = (place: Place) => {
    const key = normalized(place.name);
    const group = byName.get(key);
    if (group) group.add(place.id);
    else byName.set(key, new Set([place.id]));
  };
  existing.forEach(index);
  for (const candidate of incoming) {
    if (!isPlace(candidate)) continue;
    const p = withSeedPhoto(candidate);
    const duplicate = [...(byName.get(normalized(p.name)) ?? [])]
      .map((id) => merged.get(id)!)
      .find(
        (other) =>
          other.id !== p.id &&
          Math.abs(other.coordinates.lat - p.coordinates.lat) < 0.002 &&
          Math.abs(other.coordinates.lng - p.coordinates.lng) < 0.003,
      );
    if (duplicate) {
      merged.set(duplicate.id, {
        ...duplicate,
        wikidata: duplicate.wikidata || p.wikidata,
        wikipedia: duplicate.wikipedia || p.wikipedia,
        osmImage: duplicate.osmImage || p.osmImage,
        commons: duplicate.commons || p.commons,
        aliases: [
          ...new Set([...(duplicate.aliases || []), ...(p.aliases || [])]),
        ].slice(0, 12),
        image: duplicate.image || p.image,
      });
      continue;
    }
    const previous = merged.get(p.id);
    const next = {
      ...(previous && !p.id.startsWith("osm-") ? previous : p),
      image: p.image || previous?.image,
    };
    merged.set(p.id, next);
    if (previous && normalized(previous.name) !== normalized(next.name))
      byName.get(normalized(previous.name))?.delete(previous.id);
    index(next);
  }
  // Curated records remain available for offline use; archive recent areas too.
  const seedIds = new Set(PLACES.map((p) => p.id));
  const all = [...merged.values()];
  const recent = all.filter((p) => !seedIds.has(p.id) && !pinned.has(p.id));
  if (origin)
    recent.sort(
      (a, b) =>
        distanceKm(origin, a.coordinates) - distanceKm(origin, b.coordinates),
    );
  return [
    ...all.filter((p) => seedIds.has(p.id)),
    ...all.filter((p) => !seedIds.has(p.id) && pinned.has(p.id)),
    ...(origin ? recent.slice(0, 570) : recent.slice(-570)),
  ];
}
export function usePlaceCatalog(
  env: Environment,
  query: DiscoveryQuery,
  ready: boolean,
  state: LocalState,
) {
  const [places, setPlaces] = useState<Place[]>(() =>
    PLACES.map(withSeedPhoto),
  );
  const [catalogReady, setCatalogReady] = useState(false);
  const [placesStatus, setStatus] = useState<CatalogStatus>("loading");
  const [revision, setRevision] = useState(0);
  const [placesMessage, setMessage] = useState("");
  const pinned = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    pinned.current = new Set([
      ...state.saved,
      ...state.visits.map((v) => v.id),
      ...state.collections.flatMap((c) => c.places),
      ...state.plans.flatMap((p) =>
        p.stops.flatMap((s) => (s.placeId ? [s.placeId] : [])),
      ),
    ]);
  }, [state]);
  useEffect(() => {
    if (!ready) return;
    // One-time legacy migration; the area catalogue now persists asynchronously.
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(KEY) || "[]");
      if (Array.isArray(stored))
        setPlaces(
          mergeCatalog(
            PLACES,
            revalidateStoredPhotos(stored.filter(isPlace)),
            pinned.current,
          ),
        );
      localStorage.removeItem(KEY);
    } catch {
      /* Storage is optional. */
    }
    setCatalogReady(true);
  }, [ready]);
  const blocked =
    env.failures.includes("places") || env.failures.includes("offline");
  const radius = Math.min(
    100,
    Math.max(3, query.travel * (query.travelMode === "walk" ? 0.065 : 0.6)),
  );
  const lat = env.location.lat,
    lng = env.location.lng;
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(LOAD_BUDGET.maximum - 250),
    ]);
    const key = `${cellId({ lat, lng })}:${Math.ceil(radius / 5) * 5}`;
    setStatus("loading");
    setMessage("Finding your kind of detour…");
    async function discover() {
      const archive = await readArea(key);
      if (controller.signal.aborted) return;
      if (archive?.places.some(isPlace)) {
        setPlaces((previous) =>
          mergeCatalog(
            previous,
            revalidateStoredPhotos(archive.places.filter(isPlace)),
            pinned.current,
          ),
        );
        setStatus("cached");
        setMessage("Your recent area · refreshing quietly.");
      }
      if (blocked) {
        setStatus("fallback");
        setMessage(
          "Live discovery is unavailable. Your saved area data is still here.",
        );
        return;
      }
      if (!inUK({ lat, lng })) {
        setStatus("fallback");
        setMessage("Choose a UK starting point to find your next detour.");
        return;
      }
      let liveCompleted = false;
      const liveIds = new Set<string>();
      const accepted = new Map<string, Place>();
      const accept = (
        incoming: Place[],
        source: CatalogStatus,
        message: string,
        status = true,
        kind: "live" | "static" = "live",
      ) => {
        if (controller.signal.aborted) return;
        const valid = incoming
          .filter(isPlace)
          .filter((place) => kind !== "static" || !liveIds.has(place.id));
        if (kind === "live") valid.forEach((place) => liveIds.add(place.id));
        setPlaces((previous) =>
          mergeCatalog(previous, valid, pinned.current, { lat, lng }),
        );
        valid.forEach((place) => accepted.set(place.id, place));
        if (status) {
          setStatus(source);
          setMessage(message);
        }
      };
      // Live discovery starts alongside cells; a large or slow cell never consumes its deadline.
      const liveTask = (async () => {
        try {
          const response = await fetch(
            `/api/places?lat=${lat}&lng=${lng}&radius=${radius}&refresh=1`,
            { signal },
          );
          if (!response.ok) throw Error("Discovery unavailable");
          const data = await response.json();
          if (!Array.isArray(data.places))
            throw Error("Invalid discovery response");
          accept(
            data.places,
            ["live", "cached", "fallback"].includes(data.source)
              ? data.source
              : "fallback",
            data.message ||
              "Fresh OpenStreetMap discoveries · check practical details.",
          );
        } catch {
          if (!controller.signal.aborted) {
            setStatus("fallback");
            setMessage(
              "Showing available area data. Live discovery is unavailable; try again when you’re ready.",
            );
          }
        } finally {
          liveCompleted = true;
        }
      })();
      // Static geographic cells deliver candidates before any live enrichment.
      try {
        const areaSignal = AbortSignal.any([
          signal,
          AbortSignal.timeout(LOAD_BUDGET.area),
        ]);
        const response = await fetch("/data/venues/manifest.json", {
          signal: areaSignal,
        });
        const manifest = response.ok ? await response.json() : null;
        const ids = nearbyCells({ lat, lng }, radius).filter(
          (id) => manifest?.cells?.[id],
        );
        let cursor = 0;
        const chunks: Place[] = [];
        await Promise.all(
          Array.from({ length: Math.min(4, ids.length) }, async () => {
            while (cursor < ids.length && !areaSignal.aborted) {
              const id = ids[cursor++];
              const result = await fetch(
                `/data/venues/${id}.json?v=${manifest.cells[id].hash}`,
                { signal: areaSignal },
              );
              if (result.ok) {
                const body = await result.json();
                if (Array.isArray(body.places)) {
                  chunks.push(...body.places);
                  accept(
                    chunks,
                    "cached",
                    "Area ready · checking for fresh discoveries.",
                    !liveCompleted,
                    "static",
                  );
                }
              }
            }
          }),
        );
      } catch {
        /* Continue with cached data and bounded live discovery. */
      }
      if (controller.signal.aborted) return;
      await liveTask;
      if (!controller.signal.aborted)
        void writeArea(
          key,
          mergeCatalog([], [...accepted.values()], pinned.current, {
            lat,
            lng,
          }),
        );
    }
    void discover().finally(() => clearTimeout(timeout));
    const timeout = setTimeout(() => {
      if (!controller.signal.aborted) {
        setStatus("fallback");
        setMessage(
          "Showing available area data. You can keep browsing or retry discovery.",
        );
        controller.abort();
      }
    }, LOAD_BUDGET.maximum);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [lat, lng, radius, ready, blocked, revision]);
  const rememberPlace = useCallback(
    (place: Place) =>
      setPlaces((previous) => mergeCatalog(previous, [place], pinned.current)),
    [],
  );
  const rememberPlaces = useCallback(
    (incoming: Place[]) =>
      setPlaces((previous) => mergeCatalog(previous, incoming, pinned.current)),
    [],
  );
  const rememberPhoto = useCallback(
    (id: string, image: NonNullable<Place["image"]>) => {
      setPlaces((previous) =>
        previous.map((p) => (p.id === id ? { ...p, image } : p)),
      );
    },
    [],
  );
  const refreshPlaces = useCallback(() => setRevision((n) => n + 1), []);
  return useMemo(
    () => ({
      places,
      catalogReady,
      placesStatus,
      placesMessage,
      rememberPlace,
      rememberPlaces,
      rememberPhoto,
      refreshPlaces,
    }),
    [
      places,
      catalogReady,
      placesStatus,
      placesMessage,
      rememberPlace,
      rememberPlaces,
      rememberPhoto,
      refreshPlaces,
    ],
  );
}
