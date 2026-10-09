"use client";
import type { Place } from "@/domain/models";
import { placePhotoQuery, photoIdentity } from "./photo-query";
import {
  approvedPhoto,
  PHOTO_DEADLINE_MS,
  PHOTO_NEGATIVE_TTL_MS,
  PHOTO_TRANSIENT_TTL_MS,
} from "./photo-policy";
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
  const prepared = approvedPhoto(place.image);
  if (prepared) return Promise.resolve(prepared);
  const key = photoIdentity(query);
  const cached = cache.get(key);
  if (cached && cached.until > Date.now()) return Promise.resolve(cached.image);
  const request = pending.get(key);
  if (request) return request;
  const enqueuedAt = Date.now();
  const promise = new Promise<Image | null>((resolve) => {
    let settled = false;
    let running = false;
    const controller = new AbortController();
    const finish = (image: Image | null, retryable: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      cache.set(key, {
        image,
        retryable,
        until:
          Date.now() +
          (image
            ? 86400000
            : retryable
              ? PHOTO_TRANSIENT_TTL_MS
              : PHOTO_NEGATIVE_TTL_MS),
      });
      if (cache.size > 1000) cache.delete(cache.keys().next().value!);
      pending.delete(key);
      if (running) active--;
      else {
        const index = queue.indexOf(job);
        if (index >= 0) queue.splice(index, 1);
      }
      resolve(image);
      next();
    };
    const deadline = setTimeout(() => {
      controller.abort();
      finish(null, true);
    }, PHOTO_DEADLINE_MS);
    const job = async () => {
      running = true;
      if (Date.now() - enqueuedAt >= PHOTO_DEADLINE_MS) {
        finish(null, true);
        return;
      }
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
          signal: controller.signal,
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
            image = approvedPhoto(value) || null;
          }
        }
      } catch {
        retryable = true;
        /* Missing photos never prevent discovery. */
      }
      finish(image, retryable);
    };
    queue.push(job);
    next();
  });
  pending.set(key, promise);
  return promise;
}

export function photoRetryDelay(place: Place): number | null {
  const entry = cache.get(photoIdentity(placePhotoQuery(place)));
  return entry?.retryable ? Math.max(0, entry.until - Date.now()) + 1000 : null;
}
