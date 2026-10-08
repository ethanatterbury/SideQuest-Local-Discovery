"use client";
import type { Place } from "@/domain/models";
import { indexedPhoto, placePhotoQuery, photoIdentity } from "./photo-index";
import { parseArchivePhotoUrl, safeArchivePhotoUrl } from "./archive-photo";
type Image = NonNullable<Place["image"]>;
const cache = new Map<
  string,
  { image: Image | null; until: number; retryable: boolean }
>();
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
      let retryable = false;
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
          signal: AbortSignal.timeout(30000),
        });
        if (!response.ok)
          retryable =
            response.status === 408 ||
            response.status === 429 ||
            response.status >= 500;
        if (response.ok) {
          const data = await response.json();
          retryable = data.retryable === true;
          const value = data.image;
          if (
            value &&
            typeof value.url === "string" &&
            typeof value.credit === "string" &&
            typeof value.license === "string" &&
            typeof value.source === "string"
          ) {
            const url = new URL(value.url),
              source = new URL(value.source);
            const archive = parseArchivePhotoUrl(value.url);
            const trustedArchive =
              safeArchivePhotoUrl(value.url) &&
              safeArchivePhotoUrl(value.source, true) &&
              archive?.source === value.source;
            if (
              trustedArchive ||
              (url.protocol === "https:" &&
                !url.username &&
                !url.password &&
                !url.port &&
                url.hostname === "upload.wikimedia.org" &&
                url.pathname.startsWith("/wikipedia/commons/") &&
                source.protocol === "https:" &&
                !source.username &&
                !source.password &&
                !source.port &&
                source.hostname === "commons.wikimedia.org" &&
                source.pathname.startsWith("/wiki/File:"))
            )
              image = value;
          }
        }
      } catch {
        retryable = true;
        /* Missing photos never prevent discovery. */
      }
      cache.set(key, {
        image,
        retryable,
        until: Date.now() + (image ? 86400000 : retryable ? 30000 : 60000),
      });
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

export function photoRetryDelay(place: Place): number | null {
  const entry = cache.get(photoIdentity(placePhotoQuery(place)));
  return entry?.retryable ? Math.max(0, entry.until - Date.now()) + 1000 : null;
}
