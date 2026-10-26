import type { Place } from "@/domain/models";
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
import { effectiveDiscoveryQuery, rankPlaces } from "@/domain/discovery";

export function rankMapPlaces(
  places: Place[],
  query: DiscoveryQuery,
  env: Environment,
  state: LocalState,
) {
  const effective = effectiveDiscoveryQuery(query, places);
  const primary = rankPlaces(places, effective, env, state);
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
