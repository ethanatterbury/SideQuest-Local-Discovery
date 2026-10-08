"use client";
import type { Place } from "@/domain/models";
import { indexedPhoto, placePhotoQuery, photoIdentity } from "./photo-index";
type Image = NonNullable<Place["image"]>;
const cache = new Map<string, { image: Image | null; until: number }>();
const pending = new Map<string, Promise<Image | null>>();
const queue: (() => void)[] = [];
let active = 0;
function next() {
  if (active < 3 && queue.length) {
    active++;
    queue.shift()!();
  }
}
export function findPlacePhoto(place: Place): Promise<Image | null> {
  const query = placePhotoQuery(place);
  const indexed = indexedPhoto(query);
  if (indexed) return Promise.resolve(indexed.image);
  const key = photoIdentity(query);
  const cached = cache.get(key);
  if (cached && cached.until > Date.now()) return Promise.resolve(cached.image);
  const request = pending.get(key);
  if (request) return request;
  const promise = new Promise<Image | null>((resolve) => {
    queue.push(async () => {
      let image: Image | null = null;
      try {
        const params = new URLSearchParams({
          name: place.name,
          lat: String(place.coordinates.lat),
          lng: String(place.coordinates.lng),
        });
        for (const [field, value] of Object.entries(query)) {
          if (value !== undefined)
            params.set(
              field,
              Array.isArray(value) ? JSON.stringify(value) : String(value),
            );
        }
        const response = await fetch(`/api/photo?${params}`, {
          signal: AbortSignal.timeout(20000),
        });
        if (response.ok) {
          const value = (await response.json()).image;
          if (
            value &&
            typeof value.url === "string" &&
            typeof value.credit === "string" &&
            typeof value.license === "string" &&
            typeof value.source === "string"
          ) {
            const url = new URL(value.url),
              source = new URL(value.source);
            if (
              url.protocol === "https:" &&
              url.hostname === "upload.wikimedia.org" &&
              source.protocol === "https:" &&
              source.hostname === "commons.wikimedia.org"
            )
              image = value;
          }
        }
      } catch {
        /* Missing photos never prevent discovery. */
      }
      cache.set(key, { image, until: Date.now() + (image ? 86400000 : 60000) });
      if (cache.size > 1000) cache.delete(cache.keys().next().value!);
      pending.delete(key);
      active--;
      resolve(image);
      next();
    });
    next();
  });
  pending.set(key, promise);
  return promise;
}
