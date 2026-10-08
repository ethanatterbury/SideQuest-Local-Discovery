"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DiscoveryQuery,
  Environment,
  LocalState,
  Place,
} from "@/domain/models";
import { PLACES } from "./places";

export type CatalogStatus = "loading" | "live" | "cached" | "fallback";
const KEY = "sidequest:places:v1";
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
): Place[] {
  const merged = new Map(existing.map((p) => [p.id, p]));
  for (const p of incoming) {
    if (!isPlace(p)) continue;
    const duplicate = [...merged.values()].find(
      (other) =>
        other.id !== p.id &&
        normalized(other.name) === normalized(p.name) &&
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
    merged.set(p.id, {
      ...(previous && !p.id.startsWith("osm-") ? previous : p),
      image: p.image || previous?.image,
    });
  }
  // Curated records remain available for offline use; archive recent areas too.
  const seedIds = new Set(PLACES.map((p) => p.id));
  const all = [...merged.values()];
  return [
    ...all.filter((p) => seedIds.has(p.id)),
    ...all.filter((p) => !seedIds.has(p.id) && pinned.has(p.id)),
    ...all.filter((p) => !seedIds.has(p.id) && !pinned.has(p.id)).slice(-570),
  ];
}
export function usePlaceCatalog(
  env: Environment,
  query: DiscoveryQuery,
  ready: boolean,
  state: LocalState,
) {
  const [places, setPlaces] = useState<Place[]>(PLACES);
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
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(KEY) || "[]");
      if (Array.isArray(stored))
        setPlaces(mergeCatalog(PLACES, stored.filter(isPlace), pinned.current));
    } catch {
      /* The curated catalogue still works without storage. */
    }
    setCatalogReady(true);
  }, [ready]);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(places));
    } catch {
      /* Storage is optional. */
    }
  }, [places, ready]);
  const blocked =
    env.failures.includes("places") || env.failures.includes("offline");
  const radius = Math.min(
    50,
    Math.max(3, query.travel * (query.travelMode === "walk" ? 0.065 : 0.6)),
  );
  const lat = env.location.lat,
    lng = env.location.lng;
  useEffect(() => {
    if (!ready) return;
    if (blocked) {
      setStatus("fallback");
      setMessage(
        "Live discovery is unavailable. Your saved area data is still here.",
      );
      return;
    }
    const controller = new AbortController();
    setStatus("loading");
    setMessage("Finding more places around you…");
    fetch(`/api/places?lat=${lat}&lng=${lng}&radius=${radius}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw Error("Discovery unavailable");
        return response.json();
      })
      .then((data) => {
        if (!Array.isArray(data.places))
          throw Error("Invalid discovery response");
        setPlaces((previous) =>
          mergeCatalog(previous, data.places, pinned.current),
        );
        setStatus(
          ["live", "cached", "fallback"].includes(data.source)
            ? data.source
            : "fallback",
        );
        setMessage(
          data.message ||
            (data.source === "live"
              ? "Live places from OpenStreetMap · opening times and age limits need checking."
              : "Previously fetched places · check details before heading out."),
        );
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setStatus("fallback");
          setMessage(
            "Live discovery is taking a breather. Showing curated and saved area data.",
          );
        }
      });
    return () => controller.abort();
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
