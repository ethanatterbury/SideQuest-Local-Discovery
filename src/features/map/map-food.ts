import type { Place } from "@/domain/models";

// A food intent can describe an incidental café at an arts centre or garden.
// The map toggle applies to food venues, using their actual venue category.
export function isMapFoodPlace(
  place: Pick<Place, "category"> & Partial<Pick<Place, "intents">>,
): boolean {
  const category = place.category
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[-_]/g, " ");
  return /\b(?:cafes?|coffee|restaurants?|ice cream|pubs?|bars?|bakery|bakeries|bistro|brasserie|deli|diner|tea\s?rooms?|food|pizzeria|takeaway)\b/.test(
    category,
  );
}
