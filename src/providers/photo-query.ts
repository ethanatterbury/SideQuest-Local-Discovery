import type { PhotoQuery } from "./place-photo";
import type { Place } from "../domain/models";
export function placePhotoQuery(place: Place): PhotoQuery {
  return {
    id: place.id,
    name: place.name,
    lat: place.coordinates.lat,
    lng: place.coordinates.lng,
    area: place.area,
    category: place.category,
    aliases: place.aliases,
    wikidata: place.wikidata,
    wikipedia: place.wikipedia,
    osmImage: place.osmImage,
    commons: place.commons,
    website: place.website,
  };
}
export function photoIdentity(query: PhotoQuery): string {
  return JSON.stringify([
    query.id,
    query.name.toLowerCase().trim(),
    query.lat,
    query.lng,
    query.wikidata,
    query.wikipedia,
    query.osmImage,
    query.commons,
    query.aliases || [],
  ]);
}
