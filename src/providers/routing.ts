import type { Coordinates } from "@/domain/models";
export interface RoutingProvider {
  estimate(
    from: Coordinates,
    to: Coordinates,
    mode?: "drive" | "walk",
  ): { minutes: number; km: number; estimated: boolean };
}
export function distanceKm(a: Coordinates, b: Coordinates) {
  const rad = Math.PI / 180;
  const dlat = (b.lat - a.lat) * rad,
    dlng = (b.lng - a.lng) * rad;
  const x =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dlng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
export const estimatedRouting: RoutingProvider = {
  estimate(a, b, mode = "drive") {
    const km = distanceKm(a, b) * (mode === "walk" ? 1.2 : 1.35);
    return {
      km,
      minutes: Math.max(
        5,
        Math.ceil(
          (mode === "walk" ? (km / 4.5) * 60 : (km / 40) * 60 + 5) / 5,
        ) * 5,
      ),
      estimated: true,
    };
  },
};
export function directionsUrl(
  to: Coordinates,
  provider: "google" | "apple" = "google",
) {
  return provider === "apple"
    ? `https://maps.apple.com/?daddr=${to.lat},${to.lng}`
    : `https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lng}`;
}
