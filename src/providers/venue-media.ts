import type { Place } from "@/domain/models";
import media from "./data/venue-media.json";
import { indexedPhoto, placePhotoQuery } from "./photo-index";

export type StoredVenueMedia = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  image: NonNullable<Place["image"]>;
  originalUrl: string;
};
const entries = new Map(
  (media.entries as StoredVenueMedia[]).map((entry) => [entry.id, entry]),
);

/** Photography is data prepared ahead of browsing, never a ranking input. */
export function storedVenueImage(place: Place): Place["image"] {
  if (place.image?.url.startsWith("/images/")) return place.image;
  const stored = entries.get(place.id);
  if (
    stored &&
    stored.name === place.name &&
    Math.abs(stored.lat - place.coordinates.lat) < 0.0001 &&
    Math.abs(stored.lng - place.coordinates.lng) < 0.0001
  )
    return stored.image;
  return (
    place.image || indexedPhoto(placePhotoQuery(place))?.image || undefined
  );
}

export function withStoredPhoto(place: Place): Place {
  const image = storedVenueImage(place);
  return image === place.image ? place : { ...place, image };
}
