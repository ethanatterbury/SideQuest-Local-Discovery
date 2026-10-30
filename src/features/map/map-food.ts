import { DEFAULT_QUERY, type Place } from "@/domain/models";
import { optionalCategory } from "@/domain/venue-suitability";

// A food intent can describe an incidental café at an arts centre or garden.
// The map toggle applies to food venues, using their actual venue category.
export function isMapFoodPlace(
  place: Pick<Place, "category"> & Partial<Place>,
): boolean {
  const category = optionalCategory(place);
  return category === "food" || category === "pubs";
}

import type { DiscoveryQuery, Environment, LocalState } from "@/domain/models";
import { categoryRequested } from "@/domain/venue-suitability";
import {
  effectiveDiscoveryQuery,
  rankPlaces,
  parseIntent,
} from "@/domain/discovery";

export function rankMapPlaces(
  places: Place[],
  query: DiscoveryQuery,
  env: Environment,
  state: LocalState,
) {
  const text = query.text.trim();
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[&+]/g, " and ")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const words = normalize(text).split(" ").filter(Boolean);
  const named = text
    ? places.filter((place) =>
        [place.name, ...(place.aliases ?? [])].some((name) =>
          words.every((word) => normalize(name).includes(word)),
        ),
      )
    : [];
  const interpreted = parseIntent(text, DEFAULT_QUERY);
  const semantic = Object.keys(interpreted).some(
    (key) =>
      key !== "text" &&
      JSON.stringify(interpreted[key as keyof DiscoveryQuery]) !==
        JSON.stringify(DEFAULT_QUERY[key as keyof DiscoveryQuery]),
  );
  const nameSearch = !!text && (named.length > 0 || !semantic);
  const candidates = nameSearch ? named : places;
  const effective = nameSearch
    ? { ...query, text: "" }
    : effectiveDiscoveryQuery(query, places);
  const primary = rankPlaces(candidates, effective, env, state);
  if (text) return primary;
  const extras = rankPlaces(
    places,
    { ...effective, activity: "any", intent: "any", text: "", interests: [] },
    env,
    state,
  ).filter(({ place }) => {
    const category = optionalCategory(place);
    return category && categoryRequested(query, category);
  });
  const seen = new Set(primary.map((item) => item.place.id));
  return [...primary, ...extras.filter((item) => !seen.has(item.place.id))];
}
