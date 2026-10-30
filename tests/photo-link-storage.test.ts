import { afterEach, expect, it, vi } from "vitest";
import {
  savePhotoLink,
  storedPhotoLink,
} from "../src/providers/photo-link-storage";
const query = { id: "osm-node-123", name: "Local Museum", lat: 51, lng: -1 };
const image = {
  url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Museum.jpg/960px-Museum.jpg",
  source: "https://commons.wikimedia.org/wiki/File:Museum.jpg",
  credit: "Photographer",
  license: "CC BY-SA 4.0",
  checkedAt: new Date().toISOString(),
};
function storage() {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
  });
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("retains an approved external link across a new module/session without storing image files", async () => {
  storage();
  savePhotoLink(query, image);
  vi.resetModules();
  const fresh = await import("../src/providers/photo-link-storage");
  expect(fresh.storedPhotoLink(query)?.url).toBe(image.url);
  expect(
    fresh.storedPhotoLink({ ...query, name: "Another business" }),
  ).toBeNull();
  expect(fresh.storedPhotoLink({ ...query, id: "osm-node-124" })).toBeNull();
});
it("rejects unapproved and expired links", () => {
  storage();
  savePhotoLink(query, { ...image, license: "All rights reserved" });
  expect(storedPhotoLink(query)).toBeNull();
  savePhotoLink(query, image);
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 31 * 86400000);
  expect(storedPhotoLink(query)).toBeNull();
});
it("works when browser storage is unavailable", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw Error("blocked");
    },
    setItem: () => {
      throw Error("blocked");
    },
  });
  expect(() => savePhotoLink(query, image)).not.toThrow();
  expect(storedPhotoLink(query)).toBeNull();
});
