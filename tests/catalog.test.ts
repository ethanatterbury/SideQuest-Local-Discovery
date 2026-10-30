import { it, expect } from "vitest";
import {
  mergeCatalog,
  revalidateStoredPhotos,
} from "../src/providers/place-catalog";
import { PLACES } from "../src/providers/places";
import type { Place } from "../src/domain/models";
const live = (i: number): Place => ({
  ...PLACES[0],
  id: `osm-node-${i}`,
  name: `Test live ${i}`,
  coordinates: { lat: 51.4 + i * 0.00001, lng: -0.59 },
  image: undefined,
});
it("retains validated external photo links when restoring a recently visited area", () => {
  const place = {
    ...live(999997),
    image: {
      url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Museum.jpg",
      source: "https://commons.wikimedia.org/wiki/File:Museum.jpg",
      credit: "Photographer",
      license: "CC BY-SA 4.0",
      checkedAt: new Date().toISOString(),
    },
  };
  expect(revalidateStoredPhotos([place])[0].image?.url).toBe(place.image.url);
});
it("does not transfer a former business photograph to a renamed place at the same OSM address", () => {
  const previous = {
    ...live(999996),
    image: {
      url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Former_business.jpg",
      source: "https://commons.wikimedia.org/wiki/File:Former_business.jpg",
      credit: "Photographer",
      license: "CC BY-SA 4.0",
      checkedAt: new Date().toISOString(),
    },
  };
  const renamed = { ...previous, name: "New business", image: undefined };
  expect(mergeCatalog([previous], [renamed])[0].image).toBeUndefined();
});
it("merges ampersand/and spellings of one venue without losing separate branches", () => {
  const museum = {
    ...live(1),
    name: "Birmingham Museum & Art Gallery",
    category: "Museum",
  };
  const duplicate = {
    ...museum,
    id: "osm-way-2",
    name: "Birmingham Museum and Art Gallery",
  };
  const branch = {
    ...duplicate,
    id: "osm-way-3",
    coordinates: { lat: 52, lng: -1 },
  };
  expect(
    mergeCatalog([museum], [duplicate, branch]).map((place) => place.id),
  ).toEqual([museum.id, branch.id]);
});
it("revalidates old photographs without removing saved area records or overriding curated photos", () => {
  const stale = {
    ...live(999998),
    image: {
      url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Wrong_branch.jpg",
      source: "https://commons.wikimedia.org/wiki/File:Wrong_branch.jpg",
      credit: "Old Photographer",
      license: "CC BY-SA 4.0",
    },
  };
  const restored = revalidateStoredPhotos([
    stale,
    { ...PLACES[0], image: stale.image },
  ]);
  expect(restored[0]).toEqual({ ...stale, image: undefined });
  expect(restored[1].image).toEqual(PLACES[0].image);
  expect(stale.image.url).toContain("Wrong_branch");
});
it("retains curated records and pinned saved data when recent area data exceeds its cap", () => {
  const old = live(1),
    incoming = Array.from({ length: 600 }, (_, i) => live(i + 2));
  const merged = mergeCatalog([...PLACES, old], incoming, new Set([old.id]));
  expect(merged.some((p) => p.id === old.id)).toBe(true);
  expect(PLACES.every((p) => merged.some((v) => v.id === p.id))).toBe(true);
  expect(merged.length).toBe(601);
});
it("keeps distinct venue branches but merges a node and way for the same place", () => {
  const p = live(1);
  const same = { ...p, id: "osm-way-2" };
  const branch = { ...p, id: "osm-node-3", coordinates: { lat: 52, lng: -1 } };
  expect(mergeCatalog([p], [same, branch]).map((v) => v.id)).toEqual([
    p.id,
    branch.id,
  ]);
});
it("rejects malformed cached records and retains current curated names", () => {
  const p = PLACES[0];
  expect(
    mergeCatalog(
      [p],
      [{ ...p, name: "Old cached name" }, { id: "bad" } as Place],
    )[0].name,
  ).toBe(p.name);
  expect(mergeCatalog([p], [{ id: "bad" } as Place])).toHaveLength(1);
});
it("merges a large geographic cell without scanning unrelated venue names", () => {
  let nameReads = 0;
  const incoming = Array.from({ length: 7000 }, (_, i) => {
    const place = live(i + 100);
    Object.defineProperty(place, "name", {
      enumerable: true,
      get() {
        nameReads++;
        return `Test live ${i + 100}`;
      },
    });
    return place;
  });
  expect(mergeCatalog([], incoming)).toHaveLength(570);
  // Linear name access is deterministic; a wall-clock threshold would depend on CI hardware.
  expect(nameReads).toBeLessThan(7000 * 12);
});
it("keeps nearby candidates when the area cap is reached regardless of cell arrival order", () => {
  const near = { ...live(100), coordinates: { lat: 51.347, lng: -0.8 } };
  const distant = Array.from({ length: 650 }, (_, i) => ({
    ...live(i + 101),
    coordinates: { lat: 52 + i * 0.0001, lng: -1 },
  }));
  const merged = mergeCatalog(
    [],
    [near, ...distant],
    new Set(),
    near.coordinates,
  );
  expect(merged.some((p) => p.id === near.id)).toBe(true);
});
it("keeps replacement metadata when a duplicate node/way follows it", () => {
  const old = { ...live(77), description: "Old description" };
  const fresh = {
    ...old,
    name: "Renamed Museum",
    description: "Fresh description",
  };
  const duplicate = {
    ...fresh,
    id: "osm-way-78",
    description: "Duplicate description",
  };
  const merged = mergeCatalog([old], [fresh, duplicate]);
  expect(merged).toHaveLength(1);
  expect(merged[0].description).toBe("Fresh description");
});
it("keeps fresh verified primary play when a later plain café response refreshes the same venue", () => {
  const plain: Place = {
    ...live(444),
    category: "Café",
    optionalCategory: "food",
    experiences: undefined,
  };
  const evidence = {
    source: "official" as const,
    confidence: "verified" as const,
    url: "https://acorn-oak.co.uk/play",
    checkedAt: new Date().toISOString(),
  };
  const verified: Place = {
    ...plain,
    category: "Play café",
    optionalCategory: undefined,
    website: evidence.url,
    experiences: [{ primary: true, activities: ["soft-play"], evidence }],
    evidence: { classification: evidence },
  };
  const merged = mergeCatalog([verified], [plain])[0];
  expect(merged.category).toBe("Play café");
  expect(merged.experiences?.[0].evidence).toEqual(evidence);
  expect(merged.website).toBe(evidence.url);
});
