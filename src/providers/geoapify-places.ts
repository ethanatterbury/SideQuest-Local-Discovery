// Server-only orchestration: the browser receives normalized places, never the API key.
import type { Coordinates, Place } from "@/domain/models";
import { inUK } from "@/domain/geo-cells";
import { optionalCategory } from "@/domain/venue-suitability";
import {
  getLivePlace,
  getNearbyPlaces,
  getRememberedLivePlace,
  normalizeOsmElement,
  rememberLivePlaces,
  selectNearbyPlaces,
  snapshotArea,
  validCoordinates,
  type NearbyResult,
} from "./nearby-places";

const attribution =
  "Places by Geoapify · © OpenStreetMap contributors. Check venue details before going.";
const ttl = 30 * 60_000;
const failureTtl = 60_000;
// Live production activity/food queries exceed 2.5s. Leave room for the existing
// 4s fallback within the client's 10s overall discovery budget.
const requestBudget = 5500;
type ProviderResult = {
  places: Place[];
  partial: boolean;
  source?: NearbyResult["source"];
  message?: string;
};
type Entry = ProviderResult & { at: number; failed: boolean };
const cache = new Map<string, Entry>();
const pending = new Map<string, Promise<ProviderResult>>();
let unavailableUntil = 0;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function supportedOuting(tags: Record<string, unknown>): boolean {
  // Broad Geoapify categories also contain benches, pitches, buildings and other
  // infrastructure. Only existing mapped outing types enter the shared age engine.
  return (
    /^(playground|indoor_play|soft_play|park|garden|nature_reserve|sports_centre|fitness_centre|swimming_pool|bowling_alley|escape_game|miniature_golf|trampoline_park|water_park|amusement_ride)$/.test(
      String(tags.leisure ?? ""),
    ) ||
    /^(museum|gallery|attraction|zoo|theme_park|aquarium|viewpoint)$/.test(
      String(tags.tourism ?? ""),
    ) ||
    /^(cafe|restaurant|ice_cream|pub|bar|cinema|theatre|arts_centre)$/.test(
      String(tags.amenity ?? ""),
    ) ||
    /^(climbing|karting)$/.test(String(tags.sport ?? "")) ||
    /^(wood|heath)$/.test(String(tags.natural ?? "")) ||
    (typeof tags.shop === "string" &&
      !!tags.shop.trim() &&
      !["no", "vacant", "closed"].includes(tags.shop)) ||
    tags.landuse === "forest" ||
    tags["playground:indoor"] === "yes" ||
    tags["playground:soft_play"] === "yes"
  );
}

export function normalizeGeoapifyResponse(value: unknown): Place[] {
  const body = object(value);
  if (body?.type !== "FeatureCollection" || !Array.isArray(body.features))
    throw new Error("Invalid place response");
  const places: Place[] = [];
  const seenIds = new Set<string>();
  const seenVenues = new Set<string>();
  for (const feature of body.features.slice(0, 500)) {
    const item = object(feature);
    const properties = object(item?.properties);
    const datasource = object(properties?.datasource);
    const raw = object(datasource?.raw);
    if (
      item?.type !== "Feature" ||
      !properties ||
      !raw ||
      datasource?.sourcename !== "openstreetmap" ||
      (Array.isArray(properties.categories) &&
        properties.categories.some(
          (category) =>
            typeof category === "string" &&
            (category === "adult" || category.startsWith("adult.")),
        )) ||
      (properties.country_code !== undefined &&
        (typeof properties.country_code !== "string" ||
          properties.country_code.toLowerCase() !== "gb"))
    )
      continue;
    const type = (
      {
        n: "node",
        w: "way",
        r: "relation",
        node: "node",
        way: "way",
        relation: "relation",
      } as Record<string, string>
    )[String(raw.osm_type)];
    if (!type || !supportedOuting(raw)) continue;
    const wiki = object(properties.wiki_and_media);
    // Geoapify exposes some optional OSM fields at the top level. Raw source tags
    // take precedence, including restrictions and explicit primary-play evidence.
    const tags: Record<string, unknown> = { ...raw };
    for (const [key, fallback] of Object.entries({
      name: properties.name,
      website: properties.website,
      opening_hours: properties.opening_hours,
      "addr:city": properties.city || properties.town || properties.village,
      "addr:suburb": properties.suburb,
      "addr:postcode": properties.postcode,
      "addr:street": properties.street,
      wikidata: wiki?.wikidata,
      wikipedia: wiki?.wikipedia,
      image: wiki?.image,
      wikimedia_commons: wiki?.wikimedia_commons,
    }))
      if (tags[key] === undefined && fallback !== undefined)
        tags[key] = fallback;
    const place = normalizeOsmElement({
      type,
      id: raw.osm_id,
      lat: properties.lat,
      lon: properties.lon,
      tags,
    });
    if (!place) continue;
    const venueKey = `${place.name.toLocaleLowerCase()}|${place.coordinates.lat.toFixed(6)}|${place.coordinates.lng.toFixed(6)}`;
    if (seenIds.has(place.id) || seenVenues.has(venueKey)) continue;
    seenIds.add(place.id);
    seenVenues.add(venueKey);
    place.notes.push(
      "Place search supplied by Geoapify (https://www.geoapify.com/), using OpenStreetMap data. Geoapify does not supply these venue photographs.",
    );
    places.push(place);
  }
  return places;
}

function storeResult(key: string, result: ProviderResult, failed = false) {
  cache.set(key, { ...result, at: Date.now(), failed });
  if (cache.size > 64) cache.delete(cache.keys().next().value!);
}

function sourceMessage(partial: boolean) {
  return (
    attribution +
    (partial
      ? " Some place searches are unavailable; coverage may be incomplete."
      : "")
  );
}

async function requestPlaces(url: URL, signal: AbortSignal): Promise<Place[]> {
  const started = Date.now();
  let status: number | null = null;
  try {
    const response = await fetch(url.href, {
      headers: { Accept: "application/json" },
      signal,
      cache: "no-store",
    });
    status = response.status;
    if ([401, 403, 429].includes(status))
      unavailableUntil = Date.now() + failureTtl;
    if (!response.ok) throw new Error("Place provider unavailable");
    const body = await response.json();
    const places = normalizeGeoapifyResponse(body);
    console.info("sidequest:places-batch", {
      categories: url.searchParams.get("categories"),
      featureCount: body.features.length,
      acceptedCount: places.length,
      elapsedMs: Date.now() - started,
    });
    if (places.length < Math.max(1, body.features.length / 2))
      console.warn("sidequest:places-empty", {
        categories: url.searchParams.get("categories"),
        acceptedCount: places.length,
        featureCount: Array.isArray(body.features) ? body.features.length : 0,
        rawFields: Array.isArray(body.features)
          ? body.features.slice(0, 3).map((feature: unknown) => {
              const properties = object(object(feature)?.properties);
              return Object.keys(
                object(object(properties?.datasource)?.raw) || {},
              );
            })
          : [],
        classifications: body.features.slice(0, 3).map((feature: unknown) => {
          const properties = object(object(feature)?.properties);
          const raw = object(object(properties?.datasource)?.raw);
          return {
            categories: properties?.categories,
            amenity: raw?.amenity,
            leisure: raw?.leisure,
            tourism: raw?.tourism,
            osm_key: raw?.osm_key,
            osm_value: raw?.osm_value,
          };
        }),
      });
    return places;
  } catch (error) {
    // Never log the request URL, API key, response body or arbitrary fetch error.
    console.warn("sidequest:places-failed", {
      categories: url.searchParams.get("categories"),
      status,
      timeout: signal.aborted,
      elapsedMs: Date.now() - started,
    });
    throw error;
  }
}

export async function getDiscoveryPlaces(
  coords: Coordinates,
  radiusKm = 25,
  preferSnapshot = true,
): Promise<NearbyResult> {
  const apiKey = process.env.GEOAPIFY_API_KEY?.trim();
  if (!apiKey || !inUK(coords))
    return getNearbyPlaces(coords, radiusKm, preferSnapshot);
  if (!validCoordinates(coords) || !Number.isFinite(radiusKm))
    throw new Error("Invalid location or radius");
  const radius = Math.min(100, Math.max(3, radiusKm));
  const center = {
    lat: Math.round(coords.lat * 50) / 50,
    lng: Math.round(coords.lng * 50) / 50,
  };
  const bucket = Math.ceil(radius / 5) * 5;
  const key = `${center.lat}:${center.lng}:${bucket}`;
  const entry = cache.get(key);
  if (
    entry &&
    !entry.failed &&
    Date.now() - entry.at < (entry.partial ? failureTtl : ttl)
  )
    return {
      places: selectNearbyPlaces(entry.places, coords, radius),
      source: "cached",
      message: entry.message || sourceMessage(entry.partial),
      ...(entry.partial ? { incomplete: true } : {}),
    };
  if (
    (!entry?.failed || Date.now() - entry.at >= failureTtl) &&
    Date.now() >= unavailableUntil
  ) {
    try {
      let request = pending.get(key);
      if (!request) {
        const signal = AbortSignal.timeout(requestBudget);
        request = Promise.allSettled(
          [
            {
              // The broad entertainment request also timed out in production.
              // Keep culture and activities independently selectable/observable.
              categories:
                "entertainment.museum,entertainment.culture,entertainment.cinema",
              limit: 100,
            },
            {
              categories:
                "entertainment.activity_park,entertainment.escape_game,entertainment.bowling_alley,entertainment.aquarium,entertainment.zoo,entertainment.theme_park,entertainment.water_park,entertainment.miniature_golf",
              limit: 100,
            },
            {
              categories:
                "leisure.park,leisure.playground,natural.forest,natural.heath_moor,sport.sports_centre,sport.fitness.fitness_centre,sport.swimming_pool,tourism.attraction",
              limit: 100,
            },
            { categories: "catering", limit: 100 },
            { categories: "commercial", limit: 100 },
          ].map(({ categories, limit }) => {
            const url = new URL("https://api.geoapify.com/v2/places");
            url.search = new URLSearchParams({
              categories,
              conditions: "named",
              limit: String(limit),
              filter: `circle:${center.lng},${center.lat},${(bucket + 2) * 1000}`,
              bias: `proximity:${center.lng},${center.lat}`,
              apiKey,
            }).toString();
            return requestPlaces(url, signal);
          }),
        ).then(async (groups) => {
          let places = [
            ...new Map(
              groups
                .flatMap((group) =>
                  group.status === "fulfilled" ? group.value : [],
                )
                .map((place) => [place.id, place]),
            ).values(),
          ];
          if (!selectNearbyPlaces(places, coords, radius).length)
            throw new Error("No usable provider places");
          const hasOutings = groups
            .slice(0, 3)
            .some(
              (group) =>
                group.status === "fulfilled" &&
                selectNearbyPlaces(group.value, coords, radius).some(
                  (place) => !optionalCategory(place),
                ),
            );
          let partial = groups.some((group) => group.status === "rejected");
          let source: NearbyResult["source"] = "live";
          let message = sourceMessage(partial);
          if (
            !hasOutings ||
            groups.slice(0, 3).some((group) => group.status === "rejected")
          ) {
            // Optional food/shop results must not mask the ordinary outing fallback.
            const fallback = await getNearbyPlaces(
              coords,
              radiusKm,
              preferSnapshot,
            );
            places = [
              ...new Map(
                [...fallback.places, ...places].map((place) => [
                  place.id,
                  place,
                ]),
              ).values(),
            ];
            partial = true;
            source = fallback.source;
            message = `${sourceMessage(true)} Geoapify activity results are unavailable. ${fallback.message || (fallback.source === "live" ? "Outings supplied by live OpenStreetMap / Overpass discovery." : "Showing available OpenStreetMap outing data.")}`;
          }
          // Category-capped provider success does not mean complete local coverage.
          // Retain already available OSM snapshot venues; fresher provider identities win.
          places = [
            ...new Map(
              [...(await snapshotArea(center, bucket + 2)), ...places].map(
                (place) => [place.id, place],
              ),
            ).values(),
          ];
          rememberLivePlaces(places);
          const result = { places, partial, source, message };
          storeResult(key, result);
          return result;
        });
        pending.set(key, request);
      }
      const { places, partial, source, message } = await request;
      return {
        places: selectNearbyPlaces(places, coords, radius),
        source: source || "live",
        message: message || sourceMessage(partial),
        ...(partial ? { incomplete: true } : {}),
      };
    } catch {
      storeResult(key, { places: [], partial: false }, true);
    } finally {
      pending.delete(key);
    }
  }
  const fallback = await getNearbyPlaces(coords, radiusKm, preferSnapshot);
  return {
    ...fallback,
    incomplete: true,
    message: `Geoapify discovery is temporarily unavailable. ${fallback.message || (fallback.source === "live" ? "Fresh OpenStreetMap discoveries via Overpass · check venue details." : "Showing previously fetched OpenStreetMap places.")}`,
  };
}

/** OSM identity survives browser reloads, saved plans, and server cold starts. */
export async function getDiscoveryPlace(
  id: string,
  options: { refreshDetails?: boolean } = {},
): Promise<Place | null> {
  const match = /^osm-(node|way|relation)-([1-9]\d{0,15})$/.exec(id);
  if (!match || !Number.isSafeInteger(Number(match[2]))) return null;
  const remembered = getRememberedLivePlace(id);
  if (remembered && !options.refreshDetails) return remembered;
  const apiKey = process.env.GEOAPIFY_API_KEY?.trim();
  const key = `detail:${id}`;
  const entry = cache.get(key);
  if (
    apiKey &&
    Date.now() >= unavailableUntil &&
    (!entry?.failed || Date.now() - entry.at >= failureTtl)
  ) {
    try {
      let request = pending.get(key);
      if (!request) {
        const url = new URL("https://api.geoapify.com/v2/place-details");
        url.search = new URLSearchParams({
          osm_id: match[2],
          osm_type: match[1][0],
          apiKey,
        }).toString();
        request = requestPlaces(url, AbortSignal.timeout(requestBudget)).then(
          (places) => ({ places, partial: false }),
        );
        pending.set(key, request);
      }
      const place = (await request).places.find(
        (candidate) => candidate.id === id,
      );
      if (place && inUK(place.coordinates)) {
        rememberLivePlaces([place]);
        return place;
      }
      storeResult(key, { places: [], partial: false }, true);
    } catch {
      storeResult(key, { places: [], partial: false }, true);
    } finally {
      pending.delete(key);
    }
  }
  return getLivePlace(id);
}
