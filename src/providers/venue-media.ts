import type { Place } from "@/domain/models";
import media from "./data/venue-media.json";
import { indexedPhoto, placePhotoQuery } from "./photo-index";
import { approvedPhoto } from "./photo-policy";
import type { PhotoQuery } from "./place-photo";
import { selectPreparedPhoto } from "./photo-selection";

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

export function storedQueryImage(query: PhotoQuery): Place["image"] {
  const stored = query.id ? entries.get(query.id) : undefined;
  if (
    stored &&
    stored.name === query.name &&
    Math.abs(stored.lat - query.lat) < 0.0001 &&
    Math.abs(stored.lng - query.lng) < 0.0001
  )
    return selectPreparedPhoto([
      approvedPhoto(stored.image, media.generatedAt),
      indexedPhoto(query)?.image,
    ]);
}

/** Photography is data prepared ahead of browsing, never a ranking input. */
export function storedVenueImage(place: Place): Place["image"] {
  const supplied = approvedPhoto(place.image);
  const stored = entries.get(place.id);
  if (
    stored &&
    stored.name === place.name &&
    Math.abs(stored.lat - place.coordinates.lat) < 0.0001 &&
    Math.abs(stored.lng - place.coordinates.lng) < 0.0001
  )
    return selectPreparedPhoto([
      approvedPhoto(stored.image, media.generatedAt),
      supplied,
      indexedPhoto(placePhotoQuery(place))?.image,
    ]);
  return selectPreparedPhoto([
    supplied,
    indexedPhoto(placePhotoQuery(place))?.image,
  ]);
}

export function withStoredPhoto(place: Place): Place {
  const image = storedVenueImage(place);
  return image === place.image ? place : { ...place, image };
}
