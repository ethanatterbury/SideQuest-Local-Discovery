import type { Place } from "./models";

type Bounds = NonNullable<Place["bounds"]>;
const category = (place: Place) =>
  place.category.toLowerCase().replace(/[_-]/g, " ").trim();
const isMainAttraction = (place: Place) =>
  /^(theme park|amusement park|zoo)$/.test(category(place));
const isInterior = (place: Place) =>
  /^(amusement ride|playground|indoor soft play|soft play|local attraction|attraction|miniature golf)$/.test(
    category(place),
  );

function validBounds(place: Place): place is Place & { bounds: Bounds } {
  const b = place.bounds;
  return (
    !!b &&
    Object.values(b).every(Number.isFinite) &&
    b.south >= -90 &&
    b.north <= 90 &&
    b.west >= -180 &&
    b.east <= 180 &&
    b.south < b.north &&
    b.west < b.east &&
    place.coordinates.lat >= b.south &&
    place.coordinates.lat <= b.north &&
    place.coordinates.lng >= b.west &&
    place.coordinates.lng <= b.east
  );
}
function contains(parent: Place & { bounds: Bounds }, child: Place): boolean {
  const b = parent.bounds,
    c = child.coordinates;
  if (!(c.lat > b.south && c.lat < b.north && c.lng > b.west && c.lng < b.east))
    return false;
  if (!child.bounds) return true;
  return (
    validBounds(child) &&
    child.bounds.south >= b.south &&
    child.bounds.north <= b.north &&
    child.bounds.west >= b.west &&
    child.bounds.east <= b.east
  );
}
function officialHost(place: Place): string | undefined {
  try {
    const host = new URL(place.website).hostname.replace(/^www\./, "");
    return host && !["openstreetmap.org", "geoapify.com"].includes(host)
      ? host
      : undefined;
  } catch {
    return undefined;
  }
}

/** A reversible overview: preserve every original record and its order.
 * Spatial grouping uses real mapped extents only. Rectangular extents are less
 * precise than polygons, so ambiguous overlaps and independent sites stay visible.
 */
export function groupAttractionPlaces(places: Place[]): {
  overview: Place[];
  inside: Place[];
  parentByChild: Map<string, string>;
} {
  const parents = places.filter(isMainAttraction);
  const bounded = parents.filter(validBounds);
  const parentByChild = new Map<string, string>();
  for (const child of places) {
    if (!isInterior(child)) continue;
    let parent: Place | undefined;
    if (child.parentId) {
      parent = parents.find(
        (p) => p.id === child.parentId && p.id !== child.id,
      );
    } else {
      const host = officialHost(child);
      const candidates = bounded.filter(
        (p) =>
          p.id !== child.id &&
          contains(p, child) &&
          (!host || host === officialHost(p)),
      );
      if (candidates.length === 1) parent = candidates[0];
    }
    if (parent) parentByChild.set(child.id, parent.id);
  }
  return {
    overview: places.filter((place) => !parentByChild.has(place.id)),
    inside: places.filter((place) => parentByChild.has(place.id)),
    parentByChild,
  };
}
