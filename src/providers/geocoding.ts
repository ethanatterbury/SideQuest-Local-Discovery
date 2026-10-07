import type { Location } from "@/domain/models";
export const TOWNS: Location[] = [
  { name: "Sandhurst", lat: 51.347, lng: -0.8 },
  { name: "Camberley", lat: 51.337, lng: -0.744 },
  { name: "Bracknell", lat: 51.416, lng: -0.752 },
  { name: "Crowthorne", lat: 51.371, lng: -0.793 },
  { name: "Yateley", lat: 51.341, lng: -0.829 },
  { name: "Farnborough", lat: 51.287, lng: -0.755 },
  { name: "Fleet", lat: 51.283, lng: -0.845 },
  { name: "Windsor", lat: 51.482, lng: -0.609 },
  { name: "Reading", lat: 51.454, lng: -0.974 },
  { name: "Ascot", lat: 51.411, lng: -0.673 },
  { name: "Wokingham", lat: 51.411, lng: -0.835 },
  { name: "Guildford", lat: 51.236, lng: -0.571 },
  { name: "Woking", lat: 51.319, lng: -0.558 },
  { name: "Basingstoke", lat: 51.266, lng: -1.087 },
  { name: "Farnham", lat: 51.214, lng: -0.799 },
];
export interface GeocodingProvider {
  search(text: string, signal?: AbortSignal): Promise<Location[]>;
}
export const geocoder: GeocodingProvider = {
  async search(text, signal) {
    const preset = TOWNS.filter((t) =>
      t.name.toLowerCase().includes(text.toLowerCase()),
    );
    if (preset.length) return preset;
    const coordinates = text.match(
      /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/,
    );
    if (coordinates) {
      const lat = Number(coordinates[1]),
        lng = Number(coordinates[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180)
        return [{ name: "Selected coordinates", lat, lng }];
      return [];
    }
    if (text.length < 3) return [];
    const r = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(text)}&count=6&language=en&format=json`,
      { signal: signal || AbortSignal.timeout(8000) },
    );
    if (!r.ok) throw Error("Location search unavailable");
    const d = await r.json();
    return (d.results || [])
      .filter(
        (p: Record<string, unknown>) =>
          typeof p.latitude === "number" &&
          typeof p.longitude === "number" &&
          typeof p.name === "string",
      )
      .map(
        (p: {
          name: string;
          latitude: number;
          longitude: number;
          country: string;
        }) => ({
          name: `${p.name}, ${p.country}`,
          lat: p.latitude,
          lng: p.longitude,
        }),
      );
  },
};
