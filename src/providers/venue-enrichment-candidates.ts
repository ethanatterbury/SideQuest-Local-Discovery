import type { Coordinates, DiscoveryQuery, Place } from "@/domain/models";
import { distanceKm } from "./routing";
const normal = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^\p{L}\p{N}]/gu, "");
/** Deliberately considers cafés before optional-category filtering. A name selects a lookup, never a classification. */
export function selectVenueEnrichmentCandidates(
  places: Place[],
  query: DiscoveryQuery,
  origin: Coordinates,
  radius: number,
): Place[] {
  const cafes = places.filter(
    (place) =>
      /^osm-(?:node|way|relation)-[1-9]\d{0,15}$/.test(place.id) &&
      /\bcaf[eé](?:\b|$)|\bcoffee\b/i.test(place.category) &&
      distanceKm(origin, place.coordinates) <= radius,
  );
  const term = normal(query.text);
  const named =
    term.length >= 3
      ? cafes.filter((place) =>
          [place.name, ...(place.aliases ?? [])].some(
            (name) => normal(name) === term,
          ),
        )
      : [];
  const family =
    query.company === "family" ||
    query.intent === "kids" ||
    query.activity === "soft-play";
  const nearest = family
    ? [...cafes]
        .sort(
          (a, b) =>
            distanceKm(origin, a.coordinates) -
            distanceKm(origin, b.coordinates),
        )
        .slice(0, 6)
    : [];
  return [
    ...new Map(
      [...named.slice(0, 2), ...nearest].map((place) => [place.id, place]),
    ).values(),
  ].filter(
    (place) =>
      !place.experiences?.some(
        (item) => item.primary && item.evidence.source === "official",
      ),
  );
}
