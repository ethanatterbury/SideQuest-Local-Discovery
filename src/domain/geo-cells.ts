import type { Coordinates } from "./models";

export const CELL_SIZE = 0.25;
export const UK_BOUNDS = { south: 49.8, north: 61.1, west: -8.7, east: 2.1 };
export function inUK(c: Coordinates): boolean {
  return Number.isFinite(c.lat) && Number.isFinite(c.lng) &&
    c.lat >= UK_BOUNDS.south && c.lat <= UK_BOUNDS.north &&
    c.lng >= UK_BOUNDS.west && c.lng <= UK_BOUNDS.east;
}
export function cellId(c: Coordinates): string {
  return `${Math.floor(c.lat / CELL_SIZE)}_${Math.floor(c.lng / CELL_SIZE)}`;
}
/** Conservative bounding cells; precise distance/eligibility is checked later. */
export function nearbyCells(c: Coordinates, radiusKm: number): string[] {
  if (!inUK(c) || !Number.isFinite(radiusKm)) return [];
  const radius = Math.min(100, Math.max(1, radiusKm));
  const dy = radius / 110.5;
  const dx = radius / (111 * Math.cos(c.lat * Math.PI / 180));
  const ids: string[] = [];
  for (let y = Math.floor((c.lat - dy) / CELL_SIZE); y <= Math.floor((c.lat + dy) / CELL_SIZE); y++) {
    for (let x = Math.floor((c.lng - dx) / CELL_SIZE); x <= Math.floor((c.lng + dx) / CELL_SIZE); x++) ids.push(`${y}_${x}`);
  }
  return ids.sort((a, b) => {
    const distance = (id: string) => {
      const [y, x] = id.split("_").map(Number);
      return (y * CELL_SIZE + CELL_SIZE / 2 - c.lat) ** 2 +
        ((x * CELL_SIZE + CELL_SIZE / 2 - c.lng) * Math.cos(c.lat * Math.PI / 180)) ** 2;
    };
    return distance(a) - distance(b);
  });
}
