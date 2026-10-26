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
