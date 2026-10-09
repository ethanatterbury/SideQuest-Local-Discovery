import { inUK } from "@/domain/geo-cells";
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
  {name:"London",lat:51.5074,lng:-0.1278},
  {name:"Manchester",lat:53.4808,lng:-2.2426},
  {name:"Birmingham",lat:52.4862,lng:-1.8904},
  {name:"Bristol",lat:51.4545,lng:-2.5879},
  {name:"Edinburgh",lat:55.9533,lng:-3.1883},
  {name:"Glasgow",lat:55.8642,lng:-4.2518},
  {name:"Cardiff",lat:51.4816,lng:-3.1791},
  {name:"Belfast",lat:54.5973,lng:-5.9301},
  {name:"Newcastle",lat:54.9783,lng:-1.6178},
  {name:"York",lat:53.959,lng:-1.0815},
  {name:"Leeds",lat:53.8008,lng:-1.5491},
  {name:"Liverpool",lat:53.4084,lng:-2.9916},
  {name:"Brighton",lat:50.8225,lng:-0.1372},
  {name:"Inverness",lat:57.4778,lng:-4.2247},
  {name:"Lerwick",lat:60.1551,lng:-1.145},
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
      if (inUK({lat,lng}))
        return [{ name: "Selected coordinates", lat, lng }];
      return [];
    }
    if (text.length < 3) return [];
    const r = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(text)}&count=8&countryCode=GB&language=en&format=json`,
      { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(4500)]) : AbortSignal.timeout(4500) },
    );
    if (!r.ok) throw Error("Location search unavailable");
    const d = await r.json();
    return (d.results || [])
      .filter(
        (p: Record<string, unknown>) =>
          typeof p.latitude === "number" &&
          typeof p.longitude === "number" &&
          typeof p.name === "string" && inUK({lat: p.latitude as number, lng: p.longitude as number}) && p.country_code === "GB",
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
