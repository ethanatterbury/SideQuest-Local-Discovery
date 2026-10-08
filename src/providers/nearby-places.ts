import type { Coordinates, Place } from "@/domain/models";
import { PLACES } from "@/providers/places";
import regionalSnapshot from "./data/regional-osm.json";

export type NearbyResult = {
  places: Place[];
  source: "live" | "cached" | "fallback";
  message?: string;
};
type Element = {
  type?: unknown;
  id?: unknown;
  lat?: unknown;
  lon?: unknown;
  center?: { lat?: unknown; lon?: unknown };
  tags?: Record<string, unknown>;
};
const endpoints = [
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const cache = new Map<
  string,
  { places: Place[]; at: number; failed?: boolean }
>();
const pending = new Map<string, Promise<Place[]>>();
const details = new Map<string, Place>();
export function validCoordinates(coords: Coordinates): boolean {
  return (
    Number.isFinite(coords.lat) &&
    Math.abs(coords.lat) <= 90 &&
    Number.isFinite(coords.lng) &&
    Math.abs(coords.lng) <= 180
  );
}
export function distanceKm(a: Coordinates, b: Coordinates): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) *
      Math.cos(b.lat * rad) *
      Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
function clean(value: unknown): string {
  return typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .trim()
        .slice(0, 400)
    : "";
}
export function safeWebsite(value: unknown): string {
  try {
    const url = new URL(clean(value));
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
}
export function normalizeOsmElement(value: unknown): Place | null {
  if (!value || typeof value !== "object") return null;
  const e = value as Element;
  if (
    !["node", "way", "relation"].includes(String(e.type)) ||
    typeof e.id !== "number" ||
    !Number.isSafeInteger(e.id) ||
    e.id <= 0
  )
    return null;
  const t = e.tags;
  if (!t || typeof t !== "object") return null;
  const name = clean(t.name) || clean(t["name:en"]);
  const lat = e.lat ?? e.center?.lat,
    lng = e.lon ?? e.center?.lon;
  if (
    !name ||
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !validCoordinates({ lat, lng }) ||
    t.access === "private" ||
    t.access === "no"
  )
    return null;
  const leisure = clean(t.leisure),
    tourism = clean(t.tourism),
    amenity = clean(t.amenity),
    sport = clean(t.sport);
  const soft =
    leisure === "indoor_play" ||
    leisure === "soft_play" ||
    t["playground:indoor"] === "yes" ||
    t["playground:soft_play"] === "yes";
  let category = "Local attraction",
    environment: Place["environment"] = "mixed",
    intents: Place["intents"] = ["unusual"],
    duration: Place["duration"] = [45, 90];
  if (soft) {
    category = "Indoor soft play";
    environment = "indoor";
    intents = ["kids", "active"];
    duration = [60, 120];
  } else if (leisure === "playground") {
    category = "Playground";
    environment = t.indoor === "yes" ? "indoor" : "outdoor";
    intents = ["kids", "active"];
    duration = [30, 90];
  } else if (["park", "garden", "nature_reserve"].includes(leisure)) {
    category =
      leisure === "garden"
        ? "Gardens"
        : leisure === "nature_reserve"
          ? "Nature reserve"
          : "Park";
    environment = "outdoor";
    intents = ["walk", "scenic", "relax", "kids"];
    duration = [45, 120];
  } else if (["museum", "gallery"].includes(tourism)) {
    category = tourism === "museum" ? "Museum" : "Art gallery";
    environment = "indoor";
    intents = ["culture", "unusual", "date", "kids"];
    duration = [60, 120];
  } else if (["zoo", "theme_park", "aquarium"].includes(tourism)) {
    category =
      tourism === "zoo"
        ? "Zoo"
        : tourism === "aquarium"
          ? "Aquarium"
          : "Theme park";
    environment = tourism === "aquarium" ? "indoor" : "mixed";
    intents = ["kids", "unusual"];
    duration = [90, 240];
  } else if (tourism === "viewpoint") {
    category = "Viewpoint";
    environment = "outdoor";
    intents = ["scenic", "walk", "date"];
    duration = [20, 60];
  } else if (["cafe", "restaurant", "ice_cream"].includes(amenity)) {
    category =
      amenity === "cafe"
        ? "Café"
        : amenity === "ice_cream"
          ? "Ice cream"
          : "Restaurant";
    environment = "mixed";
    intents = ["food", "relax", "date"];
    duration = [30, 90];
  } else if (["cinema", "theatre", "arts_centre"].includes(amenity)) {
    category =
      amenity === "cinema"
        ? "Cinema"
        : amenity === "theatre"
          ? "Theatre"
          : "Arts centre";
    environment = "indoor";
    intents = ["culture", "date", "relax"];
    duration = [90, 180];
  } else if (
    [
      "sports_centre",
      "fitness_centre",
      "swimming_pool",
      "bowling_alley",
      "escape_game",
      "miniature_golf",
      "trampoline_park",
      "water_park",
    ].includes(leisure) ||
    ["climbing", "karting"].includes(sport)
  ) {
    category = leisure.replace(/_/g, " ") || sport;
    environment = ["miniature_golf", "water_park"].includes(leisure)
      ? "mixed"
      : "indoor";
    intents = ["active", "unusual"];
    duration = [60, 120];
  }
  const source = `https://www.openstreetmap.org/${e.type}/${e.id}`;
  const familyFeatures: string[] = [];
  if (soft)
    familyFeatures.push(
      "Soft play",
      "Toddler-friendly play — check session rules",
    );
  if (leisure === "playground") familyFeatures.push("Playground");
  if (t.changing_table === "yes" || t["changing_table:available"] === "yes")
    familyFeatures.push("Changing table");
  const minAge = clean(t.min_age),
    maxAge = clean(t.max_age);
  const min = /^\d{1,2}$/.test(minAge) ? Number(minAge) : undefined;
  const max = /^\d{1,2}$/.test(maxAge) ? Number(maxAge) : undefined;
  // Missing bounds are filter sentinels, not a claim of eligibility at that age.
  const ageRange: [number, number] | undefined =
    (min !== undefined || max !== undefined) && (min ?? 0) <= (max ?? 99)
      ? [min ?? 0, max ?? 99]
      : undefined;
  const notes = [
    "Place information: © OpenStreetMap contributors (ODbL). Check venue details before leaving.",
    "Visit duration is a SideQuest estimate. Admission and availability have not been verified.",
  ];
  if (ageRange) {
    notes.push(
      `Age limits reported by OpenStreetMap: ${min !== undefined ? `minimum ${min}` : "minimum unknown"}, ${max !== undefined ? `maximum ${max}` : "maximum unknown"}. Missing bounds in filters do not establish eligibility; confirm venue rules.`,
    );
  }
  const hours = clean(t.opening_hours);
  if (hours)
    notes.push(
      `Opening hours reported by OpenStreetMap: ${hours}. Confirm with the venue.`,
    );
  const description =
    clean(t.description) ||
    `${category} mapped by OpenStreetMap contributors. Check access, opening times and booking requirements with the venue.`;
  return {
    id: `osm-${e.type}-${e.id}`,
    name,
    area:
      [
        clean(t["addr:city"]) ||
          clean(t["addr:town"]) ||
          clean(t["addr:village"]),
        clean(t["addr:suburb"]),
      ]
        .filter(Boolean)
        .join(", ") || "Nearby",
    coordinates: { lat, lng },
    category,
    environment,
    intents,
    company: intents.includes("kids")
      ? ["family", "friends"]
      : ["solo", "couple", "friends"],
    duration,
    cost: t.fee === "no" ? 0 : null,
    costLabel:
      t.fee === "no"
        ? "No admission fee reported · check extras"
        : "Check admission & prices",
    novelty: 0.65,
    daylightOnly:
      environment === "outdoor" && t.lit !== "yes" && hours !== "24/7",
    website:
      safeWebsite(t.website) || safeWebsite(t["contact:website"]) || source,
    source,
    tagline: `${category} near you`,
    description,
    notes,
    familyFeatures,
    ageRange,
    wikidata: /^Q\d+$/.test(clean(t.wikidata)) ? clean(t.wikidata) : undefined,
    wikipedia: clean(t.wikipedia) || undefined,
  };
}
export function normalizeOsmResponse(value: unknown): Place[] {
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray((value as { elements?: unknown }).elements)
  )
    throw new Error("Invalid place response");
  const places: Place[] = [],
    seen = new Set<string>();
  for (const element of (value as { elements: unknown[] }).elements) {
    const place = normalizeOsmElement(element);
    if (!place) continue;
    // Nodes and enclosing ways commonly represent the same venue; branches at different coordinates remain distinct.
    const key = `${place.name.toLocaleLowerCase()}|${place.coordinates.lat.toFixed(6)}|${place.coordinates.lng.toFixed(6)}`;
    if (!seen.has(key)) {
      seen.add(key);
      places.push(place);
    }
  }
  return places;
}
export function selectNearbyPlaces(
  places: Place[],
  coords: Coordinates,
  radius: number,
): Place[] {
  const sorted = places
    .filter((p) => distanceKm(coords, p.coordinates) <= radius)
    .sort(
      (a, b) =>
        distanceKm(coords, a.coordinates) - distanceKm(coords, b.coordinates),
    );
  if (sorted.length <= 300) return sorted;
  const selected = sorted.slice(0, 200);
  const groups = new Map<string, Place[]>();
  for (const place of sorted.slice(200)) {
    const group = groups.get(place.category) ?? [];
    group.push(place);
    groups.set(place.category, group);
  }
  while (selected.length < 300) {
    let added = false;
    for (const group of groups.values()) {
      const place = group.shift();
      if (place) {
        selected.push(place);
        added = true;
      }
      if (selected.length === 300) break;
    }
    if (!added) break;
  }
  return selected.sort(
    (a, b) =>
      distanceKm(coords, a.coordinates) - distanceKm(coords, b.coordinates),
  );
}
const snapshotPlaces = normalizeOsmResponse(regionalSnapshot);
const snapshotById = new Map(snapshotPlaces.map((place) => [place.id, place]));
const snapshotMessage = `OpenStreetMap area snapshot · imported ${regionalSnapshot.generatedAt.slice(0, 10)} · check venue details before going.`;
async function queryOverpass(query: string): Promise<Place[]> {
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent":
            "SideQuest/1.0 (https://sidequest-local-discovery.vercel.app)",
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(10500),
        cache: "no-store",
      });
      if (!response.ok) continue;
      return normalizeOsmResponse(await response.json());
    } catch {
      /* Try a mirror before using cached or curated results. */
    }
  }
  throw new Error("Nearby discovery is temporarily unavailable");
}
function remember(places: Place[]) {
  for (const place of places) {
    details.set(place.id, place);
    if (details.size > 3000) details.delete(details.keys().next().value!);
  }
}
export async function getNearbyPlaces(
  coords: Coordinates,
  radiusKm = 25,
  preferSnapshot = true,
): Promise<NearbyResult> {
  if (!validCoordinates(coords) || !Number.isFinite(radiusKm))
    throw new Error("Invalid location or radius");
  const radius = Math.min(50, Math.max(3, radiusKm));
  const center = {
    lat: Math.round(coords.lat * 50) / 50,
    lng: Math.round(coords.lng * 50) / 50,
  };
  const bucket = Math.ceil(radius / 5) * 5,
    key = `${center.lat}:${center.lng}:${bucket}`;
  const entry = cache.get(key),
    now = Date.now();
  const within = (places: Place[]) =>
    selectNearbyPlaces(places, coords, radius);
  if (entry && now - entry.at < (entry.failed ? 60_000 : 1_800_000))
    return {
      places: within(entry.places),
      source: entry.failed ? "fallback" : "cached",
      ...(entry.failed
        ? {
            message: entry.places.some((place) => snapshotById.has(place.id))
              ? snapshotMessage + " Live discovery is temporarily unavailable."
              : "Live discovery is unavailable. Showing curated places where available.",
          }
        : {}),
    };
  const areaSnapshot = within(snapshotPlaces);
  if (preferSnapshot && areaSnapshot.length)
    return {
      places: within([...PLACES, ...areaSnapshot]),
      source: "cached",
      message: snapshotMessage,
    };
  try {
    let request = pending.get(key);
    if (!request) {
      const around = `(around:${Math.round((bucket + 2) * 1000)},${center.lat},${center.lng})`;
      // Separate output budgets prevent cafés or large parks crowding out family activities.
      const query = `[out:json][timeout:9];
        nwr${around}[name][leisure~"^(playground|indoor_play|soft_play|trampoline_park|water_park)$"];out center tags 350;
        nwr${around}[name][leisure~"^(park|garden|nature_reserve)$"];out center tags 350;
        nwr${around}[name][tourism~"^(museum|gallery|attraction|zoo|theme_park|aquarium|viewpoint)$"];out center tags 500;
        nwr${around}[name][amenity~"^(cafe|restaurant|ice_cream)$"];out center tags 300;
        nwr${around}[name][amenity~"^(cinema|theatre|arts_centre)$"];out center tags 200;
        (nwr${around}[name][leisure~"^(sports_centre|fitness_centre|swimming_pool|bowling_alley|escape_game|miniature_golf)$"];nwr${around}[name][sport~"^(climbing|karting)$"];);out center tags 200;`;
      request = queryOverpass(query);
      pending.set(key, request);
    }
    const livePlaces = await request;
    const places = [
      ...new Map(
        [...areaSnapshot, ...livePlaces].map((place) => [place.id, place]),
      ).values(),
    ];
    remember(places);
    cache.set(key, { places, at: Date.now() });
    if (cache.size > 64) cache.delete(cache.keys().next().value!);
    return { places: within(places), source: "live" };
  } catch {
    if (entry && !entry.failed) {
      cache.set(key, { ...entry, at: Date.now() - 1_740_000 });
      return {
        places: within(entry.places),
        source: "cached",
        message:
          "Live discovery is unavailable. Showing previously fetched places.",
      };
    }
    const places = within([...PLACES, ...areaSnapshot]);
    cache.set(key, { places, at: Date.now(), failed: true });
    if (cache.size > 64) cache.delete(cache.keys().next().value!);
    return {
      places,
      source: "fallback",
      message: areaSnapshot.length
        ? snapshotMessage + " Live discovery is temporarily unavailable."
        : "Live discovery is temporarily unavailable. Try again shortly; curated places are shown where available.",
    };
  } finally {
    pending.delete(key);
  }
}
export async function getLivePlace(id: string): Promise<Place | null> {
  const match = /^osm-(node|way|relation)-([1-9]\d{0,15})$/.exec(id);
  if (!match || !Number.isSafeInteger(Number(match[2]))) return null;
  if (details.has(id)) return details.get(id)!;
  if (snapshotById.has(id)) return snapshotById.get(id)!;
  const key = `detail:${id}`;
  try {
    let request = pending.get(key);
    if (!request) {
      request = queryOverpass(
        `[out:json][timeout:7];${match[1]}(${match[2]});out center tags;`,
      );
      pending.set(key, request);
    }
    const places = await request;
    remember(places);
    return places.find((p) => p.id === id) || null;
  } catch {
    return null;
  } finally {
    pending.delete(key);
  }
}
