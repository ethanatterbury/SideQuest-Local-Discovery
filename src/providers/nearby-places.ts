import type { Coordinates, Place } from "@/domain/models";
import { PLACES } from "@/providers/places";
import {
  effectiveCompany,
  inferVenueSuitability,
} from "@/domain/venue-suitability";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { nearbyCells, inUK } from "@/domain/geo-cells";
import { weeklyHours } from "@/domain/opening-hours";
import existingEvidence from "./data/venue-evidence.json";
import { LOAD_BUDGET } from "@/domain/performance";

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
function mediaText(value: unknown): string {
  return typeof value === "string" &&
    value.length <= 2048 &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    !/%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)
    ? value.trim()
    : "";
}
function mediaUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.href.length <= 2048
      ? url
      : null;
  } catch {
    return null;
  }
}
function commonsReference(value: unknown): string | undefined {
  let reference = mediaText(value);
  if (!reference) return undefined;
  if (/^https?:/i.test(reference)) {
    const url = mediaUrl(reference);
    if (
      url?.hostname !== "commons.wikimedia.org" ||
      !url.pathname.startsWith("/wiki/")
    )
      return undefined;
    try {
      reference = decodeURIComponent(url.pathname.slice(6));
    } catch {
      return undefined;
    }
  }
  const match = /^(File|Category):(.+)$/i.exec(reference);
  const title = match?.[2].replace(/_/g, " ").trim();
  if (!title || !mediaText(title) || /[\[\]{}<>|#?\\]/.test(title))
    return undefined;
  return `${match![1].toLowerCase() === "file" ? "File" : "Category"}:${title}`;
}
function osmImageReference(value: unknown): string | undefined {
  const text = mediaText(value);
  if (!text) return undefined;
  const reference = commonsReference(text);
  if (reference?.startsWith("File:")) return reference;
  const url = mediaUrl(text);
  if (url) return url.href;
  // OSM image tags also contain plain Commons filenames, without a namespace.
  return !/[/:]/.test(text) && /\.(?:jpe?g|png|webp|gif|tiff?)$/i.test(text)
    ? commonsReference(`File:${text}`)
    : undefined;
}
function osmAliases(
  tags: Record<string, unknown>,
  name: string,
): string[] | undefined {
  const aliases: string[] = [];
  const seen = new Set([name.toLocaleLowerCase()]);
  for (const key of ["name:en", "alt_name", "old_name"]) {
    const raw = tags[key];
    if (typeof raw !== "string") continue;
    for (const value of raw.slice(0, 2400).split(";")) {
      const alias = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
      const normalized = alias.toLocaleLowerCase();
      if (!alias || alias.length > 200 || seen.has(normalized)) continue;
      aliases.push(alias);
      seen.add(normalized);
      if (aliases.length === 12) return aliases;
    }
  }
  return aliases.length ? aliases : undefined;
}

/** Specific mapped rides override broad venue tags such as cinema or aquarium. */
function isAmusementRide(tags: Record<string, unknown>): boolean {
  const mapped = (key: string) => {
    const value = clean(tags[key]).toLowerCase();
    return !!value && !["no", "false", "0"].includes(value);
  };
  return (
    clean(tags.leisure) === "amusement_ride" ||
    mapped("amusement_ride") ||
    mapped("roller_coaster") ||
    /^(amusement_ride|roller_coaster|carousel|big_wheel|ferris_wheel|pirate_ship|free_fall|drop_tower|simulator|motion_simulator|flying_theatre|flying_theater|dark_ride|water_ride|water_slide|log_flume|river_rafting|kiddie_ride|swing_carousel|bumper_car|bumper_cars)$/.test(
      clean(tags.attraction).toLowerCase(),
    )
  );
}
function parseHeight(value: unknown): number | null {
  const match = /^(\d+(?:\.\d+)?)\s*(m|cm)?$/.exec(clean(value));
  if (!match) return null;
  const height = Number(match[1]) * (match[2] === "cm" ? 1 : 100);
  return height > 20 && height < 250 ? height : null;
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
  // Ancillary infrastructure is not an outing, even when inherited leisure tags are present.
  if (
    ["parking", "parking_entrance", "toilets", "changing_room"].includes(
      clean(t.amenity),
    ) ||
    /\b(?:changing (?:facilit(?:y|ies)|rooms?)|locker rooms?)\b/i.test(name) ||
    ["yes", "construction"].includes(clean(t.construction)) ||
    t.disused === "yes" ||
    t.abandoned === "yes"
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
  // Retain previously verified source evidence through a generic adapter, not ID-specific rules.
  const knownEvidence = existingEvidence.entries.find(
    (record) =>
      record.id === `osm-${e.type}-${e.id}` &&
      record.name === name &&
      Date.now() - Date.parse(record.checkedAt) < 90 * 86400000,
  );
  const mappedRideWebsite = /\/(?:rides?|rides-attractions)\//i.test(
    clean(t.website) || clean(t["contact:website"]),
  );
  let category = "Local attraction",
    environment: Place["environment"] = "mixed",
    intents: Place["intents"] = ["unusual"],
    duration: Place["duration"] = [45, 90];
  if (
    knownEvidence?.classification === "amusement-ride" ||
    mappedRideWebsite ||
    isAmusementRide(t)
  ) {
    category = "Amusement ride";
    environment =
      t.indoor === "yes" || amenity === "cinema"
        ? "indoor"
        : t.indoor === "no"
          ? "outdoor"
          : "mixed";
    intents = ["active", "unusual"];
  } else if (soft) {
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
  } else if (["pub", "bar"].includes(amenity)) {
    category = amenity === "pub" ? "Pub" : "Bar";
    environment = "mixed";
    intents = ["food", "date"];
  } else if (clean(t.shop)) {
    category = "Shop";
    intents = ["relax"];
    environment = "indoor";
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
  if (soft) familyFeatures.push("Soft play");
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
  if (knownEvidence)
    notes.push(
      `Classification source checked ${knownEvidence.checkedAt}: ${knownEvidence.url}. Height and accompaniment requirements need checking; no age is inferred from height.`,
    );
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
    (mappedRideWebsite
      ? "An amusement ride within a larger attraction. Check height, accompaniment, access and booking requirements with the venue."
      : `${category} mapped by OpenStreetMap contributors. Check access, opening times and booking requirements with the venue.`);
  const place: Place = {
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
    // Estimated experience depth, not a rating or claim of visitor satisfaction.
    quality: [
      "Museum",
      "Art gallery",
      "Zoo",
      "Aquarium",
      "Theme park",
    ].includes(category)
      ? 0.75
      : ["Cinema", "Theatre", "Arts centre"].includes(category)
        ? 0.65
        : ["Indoor soft play", "Playground"].includes(category)
          ? 0.55
          : ["Park", "Local attraction"].includes(category)
            ? 0.2
            : ["Nature reserve", "Viewpoint", "Gardens"].includes(category)
              ? 0.4
              : 0.6,
    optionalCategory: ["pub", "bar"].includes(amenity)
      ? "pubs"
      : clean(t.shop)
        ? "shops"
        : leisure === "fitness_centre"
          ? "fitness"
          : ["cafe", "restaurant", "ice_cream", "fast_food"].includes(amenity)
            ? "food"
            : undefined,
    access: {
      wheelchair: ["yes", "limited", "no"].includes(clean(t.wheelchair))
        ? (clean(t.wheelchair) as "yes" | "limited" | "no")
        : undefined,
      stepFree:
        t["wheelchair:description"] === "step-free" || t.steps === "no"
          ? "yes"
          : undefined,
      dogs: ["yes", "no"].includes(clean(t.dog))
        ? (clean(t.dog) as "yes" | "no")
        : undefined,
      public: !["private", "no", "customers", "permit"].includes(
        clean(t.access),
      ),
    },
    evidence: {
      quality: { source: "inferred", confidence: "unknown" },
      classification: knownEvidence
        ? {
            source: "official",
            url: knownEvidence.url,
            checkedAt: knownEvidence.checkedAt,
            confidence: "verified",
          }
        : { source: "osm", url: source, confidence: "reported" },
      access: {
        source: "osm",
        url: source,
        confidence: t.wheelchair ? "reported" : "unknown",
      },
    },
    openingHoursRaw: hours || undefined,
    hours: weeklyHours(hours),
    requiresBooking: t.reservation === "required" || t.booking === "required",
    heightRange:
      t.min_height || t.max_height
        ? [parseHeight(t.min_height), parseHeight(t.max_height)]
        : undefined,
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
      safeWebsite(t.website) ||
      safeWebsite(t["contact:website"]) ||
      knownEvidence?.url ||
      source,
    source,
    tagline: `${category} near you`,
    description,
    notes,
    familyFeatures,
    ageRange,
    wikidata: /^Q\d+$/.test(clean(t.wikidata)) ? clean(t.wikidata) : undefined,
    wikipedia: clean(t.wikipedia) || undefined,
    osmImage: osmImageReference(t.image),
    commons: commonsReference(t.wikimedia_commons),
    aliases: osmAliases(t, name),
  };
  place.suitability = {
    ...inferVenueSuitability(place),
    source: knownEvidence ? "official" : "osm",
  };
  place.company = effectiveCompany(place);
  if (place.suitability.requiresAgeCheck)
    place.notes.push(
      "This activity may have minimum age, height, swimming or supervision rules. Unknown restrictions do not establish suitability for children.",
    );
  return place;
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
  const selected: Place[] = [];
  const groups = new Map<string, Place[]>();
  for (const place of sorted) {
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
const snapshotMessage =
  "OpenStreetMap area snapshot · check venue details before going.";
const cellCache = new Map<string, Place[]>();
async function readCell(id: string): Promise<Place[]> {
  if (!/^\d+_-?\d+$/.test(id)) return [];
  if (cellCache.has(id)) return cellCache.get(id)!;
  try {
    const data = JSON.parse(
      await readFile(
        path.join(process.cwd(), "public/data/venues", id + ".json"),
        "utf8",
      ),
    );
    const places = Array.isArray(data.places) ? (data.places as Place[]) : [];
    cellCache.set(id, places);
    if (cellCache.size > 80) cellCache.delete(cellCache.keys().next().value!);
    return places;
  } catch {
    return [];
  }
}
async function snapshotArea(
  coords: Coordinates,
  radius: number,
): Promise<Place[]> {
  return (await Promise.all(nearbyCells(coords, radius).map(readCell))).flat();
}
async function queryOverpass(query: string): Promise<Place[]> {
  const deadline = AbortSignal.timeout(LOAD_BUDGET.live);
  for (const endpoint of endpoints) {
    if (deadline.aborted) break;
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
        signal: AbortSignal.any([deadline, AbortSignal.timeout(2200)]),
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
  if (!inUK(coords))
    return {
      places: [],
      source: "fallback",
      message:
        "SideQuest currently discovers experiences across the UK. Choose a UK starting point.",
    };
  const radius = Math.min(100, Math.max(3, radiusKm));
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
            message: entry.places.some((place) => place.id.startsWith("osm-"))
              ? snapshotMessage + " Live discovery is temporarily unavailable."
              : "Live discovery is unavailable. Showing curated places where available.",
          }
        : {}),
    };
  const areaSnapshot = within(await snapshotArea(coords, radius));
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
      const query = `[out:json][timeout:3];
        nwr${around}[name][leisure~"^(playground|indoor_play|soft_play|trampoline_park|water_park)$"];out center tags 350;
        nwr${around}[name][leisure~"^(park|garden|nature_reserve)$"];out center tags 350;
        nwr${around}[name][tourism~"^(museum|gallery|attraction|zoo|theme_park|aquarium|viewpoint)$"];out center tags 500;
        nwr${around}[name][amenity~"^(cafe|restaurant|ice_cream|pub|bar)$"];out center tags 300;
        nwr${around}[name][shop];out center tags 100;
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
  try {
    const index = JSON.parse(
      await readFile(
        path.join(process.cwd(), "public/data/venues/id-index.json"),
        "utf8",
      ),
    );
    if (typeof index[id] === "string") {
      const found = (await readCell(index[id])).find(
        (place) => place.id === id,
      );
      if (found) return found;
    }
  } catch {
    /* Missing data still permits a bounded live lookup. */
  }
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
