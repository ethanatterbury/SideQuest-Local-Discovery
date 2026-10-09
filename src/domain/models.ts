export type Coordinates = { lat: number; lng: number };
export type Location = Coordinates & { name: string };
export type OptionalCategory = "food" | "pubs" | "fitness" | "shops";
export type Evidence = { source: "osm" | "official" | "wikidata" | "inferred"; url?: string; checkedAt?: string; confidence: "reported" | "verified" | "unknown" };
export type AccessNeeds = { wheelchair?: boolean; stepFree?: boolean; dogs?: boolean };
export type PlaceAccess = { wheelchair?: "yes" | "limited" | "no"; stepFree?: "yes" | "no"; dogs?: "yes" | "no"; public?: boolean };

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
  cloudCover?: number;
  windDirection?: number;
  gusts?: number;
  snowfall?: number;
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
  cloudCover?: number;
  windDirection?: number;
  gusts?: number;
  snowfall?: number;
  atmosphereQuality?: "auto" | "high" | "low";
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
  optionalCategory?: OptionalCategory;
  access?: PlaceAccess;
  evidence?: Record<string, Evidence>;
  parentId?: string;
  requiresBooking?: boolean;
  heightRange?: [number | null, number | null];
  quality?: number;
  openingHoursRaw?: string;
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
  image?: {
    url: string;
    credit: string;
    license: string;
    source: string;
    width?: number;
    height?: number;
    confidence?: number;
    strategy?: string;
    matched?: string[];
    blurDataURL?: string;
    rights?: "open" | "permissioned" | "unverified";
    checkedAt?: string;
  };
  season?: number[];
  /** Only populate from verified venue age guidance. */
  ageRange?: [number, number];
  familyFeatures?: string[];
  suitability?: import("./venue-suitability").VenueSuitability;
  wikidata?: string;
  wikipedia?: string;
  /** OSM source hints only; licensing and subject identity still need verification. */
  osmImage?: string;
  commons?: string;
  aliases?: string[];
};
export type Activity =
  | "any"
  | "soft-play"
  | "playground"
  | "museum"
  | "cinema"
  | "animals"
  | "gardens"
  | "climbing"
  | "swimming"
  | "food"
  | "walk"
  | "pubs"
  | "fitness"
  | "shops";
export type DiscoveryQuery = {
  activity?: Activity;
  intent: Intent;
  company: Company;
  childrenAges?: number[];
  interests?: Intent[];
  includeCategories?: OptionalCategory[];
  accessNeeds?: AccessNeeds;
  strictSuitability?: boolean;
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
  impressions?: { id: string; date: string }[];
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
