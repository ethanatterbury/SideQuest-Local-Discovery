import { it, expect } from "vitest";
import { mergeCatalog } from "../src/providers/place-catalog";
import { PLACES } from "../src/providers/places";
import type { Place } from "../src/domain/models";
const live = (i: number): Place => ({
  ...PLACES[0],
  id: `osm-node-${i}`,
  name: `Test live ${i}`,
  coordinates: { lat: 51.4 + i * 0.00001, lng: -0.59 },
  image: undefined,
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
