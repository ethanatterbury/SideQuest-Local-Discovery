import type { Place } from "@/domain/models";
import seedMedia from "./data/seed-venue-media.json";
import { approvedPhoto } from "./photo-policy";
// Only the small offline seed is bundled. Regional media arrives in the catalogue response.
const entries = new Map(
  (
    seedMedia.entries as { id: string; image: NonNullable<Place["image"]> }[]
  ).map((entry) => [entry.id, entry.image]),
);
export function seedVenueImage(place: Place): Place["image"] {
  const supplied = approvedPhoto(place.image);
  return supplied?.url.startsWith("/images/")
    ? supplied
    : approvedPhoto(entries.get(place.id)) || supplied;
}
export function withSeedPhoto(place: Place): Place {
  const image = seedVenueImage(place);
  return image === place.image ? place : { ...place, image };
}
