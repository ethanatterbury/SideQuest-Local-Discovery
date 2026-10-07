export type Coordinates = { lat: number; lng: number };
export type Location = Coordinates & { name: string };
export type WeatherKind =
  | "clear"
  | "sunny"
  | "partly-cloudy"
  | "overcast"
  | "light-rain"
  | "heavy-rain"
  | "thunderstorm"
  | "fog"
  | "snow"
  | "heat"
  | "high-wind";
export type TimeKind =
  | "live"
  | "sunrise"
  | "morning"
  | "midday"
  | "golden-hour"
  | "sunset"
  | "evening"
  | "midnight";
export type Failure =
  | "weather"
  | "location-denied"
  | "location-timeout"
  | "map"
  | "places"
  | "empty"
  | "offline";
export type Weather = {
  kind: WeatherKind;
  temperature: number;
  rain: number;
  wind: number;
  visibility: number;
  sunrise: string;
  sunset: string;
  observedAt: string;
  source: "live" | "cached" | "unavailable" | "simulation";
  rainAt?: string;
};
export type Environment = {
  location: Location;
  now: string;
  weather: Weather;
  reducedMotion: boolean;
  failures: Failure[];
};
export type EnvironmentOverrides = {
  weather?: WeatherKind;
  time?: TimeKind;
  temperature?: number;
  rain?: number;
  wind?: number;
  visibility?: number;
  location?: Location;
  reducedMotion?: boolean;
  failures?: Failure[];
  device?: string;
};
export type Company = "solo" | "couple" | "family" | "friends";
export type Intent =
  | "any"
  | "scenic"
  | "walk"
  | "unusual"
  | "relax"
  | "culture"
  | "active"
  | "food"
  | "date"
  | "kids";
export type OpeningWindow = { days: number[]; open: number; close: number };
export type Place = {
  id: string;
  name: string;
  area: string;
  coordinates: Coordinates;
  category: string;
  description: string;
  tagline: string;
  environment: "indoor" | "outdoor" | "mixed";
  intents: Intent[];
  company: Company[];
  duration: [number, number];
  cost: number | null;
  costLabel: string;
  novelty: number;
  daylightOnly: boolean;
  exposed?: boolean;
  hours?: OpeningWindow[];
  website: string;
  source: string;
  notes: string[];
  image?: { url: string; credit: string; license: string; source: string };
  season?: number[];
};
export type DiscoveryQuery = {
  intent: Intent;
  company: Company;
  minutes: number;
  travel: number;
  budget: number;
  environment: "any" | "indoor" | "outdoor";
  mode: "normal" | "surprise";
  text: string;
  travelMode: "drive" | "walk";
};
export type Reaction = "Loved it" | "Good" | "Meh" | "Not again";
export type Visit = {
  id: string;
  date: string;
  reaction: Reaction;
  note: string;
  km: number;
};
export type Dismissal = { id: string; reason: string; date: string };
export type Collection = { id: string; name: string; places: string[] };
export type LocalState = {
  version: 1;
  saved: string[];
  visits: Visit[];
  dismissed: Dismissal[];
  recent: string[];
  collections: Collection[];
  preferences: Partial<DiscoveryQuery>;
  plans: Itinerary[];
};
export type OpeningStatus = {
  status: "open" | "closes-soon" | "closed" | "opens-later" | "unknown";
  remaining?: number;
  label: string;
};
export type Recommendation = {
  place: Place;
  score: number;
  travel: number;
  km: number;
  explanation: string;
  components: Record<string, number>;
  opening: OpeningStatus;
  reasons: string[];
};
export type ItineraryStop = {
  type: "leave" | "place" | "break" | "home";
  name: string;
  at: string;
  minutes: number;
  placeId?: string;
  cost: number;
  unknownCost?: boolean;
  coordinates: Coordinates;
};
export type Itinerary = {
  id: string;
  created: string;
  start: string;
  stops: ItineraryStop[];
  minutes: number;
  cost: number;
  unknownCost: boolean;
  query: DiscoveryQuery;
  origin: Location;
};
export const DEFAULT_QUERY: DiscoveryQuery = {
  intent: "any",
  company: "couple",
  minutes: 180,
  travel: 30,
  budget: 40,
  environment: "any",
  mode: "normal",
  text: "",
  travelMode: "drive",
};
