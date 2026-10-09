import type { Place } from "@/domain/models";
import seedMedia from "./data/seed-venue-media.json";
// Only the small offline seed is bundled. Regional media arrives in the catalogue response.
const entries = new Map(
  (
    seedMedia.entries as { id: string; image: NonNullable<Place["image"]> }[]
  ).map((entry) => [entry.id, entry.image]),
);
export function seedVenueImage(place: Place): Place["image"] {
  if (place.image?.url.startsWith("/images/")) return place.image;
  return entries.get(place.id) || place.image;
}
export function withSeedPhoto(place: Place): Place {
  const image = seedVenueImage(place);
  return image === place.image ? place : { ...place, image };
}
