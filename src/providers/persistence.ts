import {
  DEFAULT_QUERY,
  type LocalState,
  type DiscoveryQuery,
  type Itinerary,
} from "@/domain/models";
export interface PreferenceStore {
  read(): LocalState;
  write(state: LocalState): boolean;
}
export type SavedPlacesStore = PreferenceStore;
export type HistoryStore = PreferenceStore;
export type CollectionStore = PreferenceStore;
const defaultCollections = [
  "Want to go",
  "Date ideas",
  "With kids",
  "Weekend",
  "Food + drink",
];
export function emptyState(): LocalState {
  return {
    version: 1,
    saved: [],
    visits: [],
    dismissed: [],
    recent: [],
    collections: defaultCollections.map((name, i) => ({
      id: `collection-${i}`,
      name,
      places: [],
    })),
    preferences: {},
    plans: [],
  };
}
export function validatedPreferences(d: unknown): Partial<DiscoveryQuery> {
  if (!d || typeof d !== "object") return {};
  const p = d as Record<string, unknown>,
    q: Partial<DiscoveryQuery> = {};
  for (const [key, min, max] of [
    ["minutes", 30, 720],
    ["travel", 5, 120],
    ["budget", 0, 200],
  ] as const) {
    if (
      typeof p[key] === "number" &&
      Number.isFinite(p[key]) &&
      p[key] >= min &&
      p[key] <= max
    )
      q[key] = p[key];
  }
  if (
    Array.isArray(p.childrenAges) &&
    p.childrenAges.length <= 8 &&
    p.childrenAges.every(
      (age) =>
        typeof age === "number" &&
        Number.isInteger(age) &&
        age >= 0 &&
        age <= 17,
    )
  ) {
    q.childrenAges = [...p.childrenAges];
  }
  const enums = {
    activity: [
      "any",
      "soft-play",
      "playground",
      "museum",
      "cinema",
      "animals",
      "gardens",
      "climbing",
      "swimming",
      "food",
      "walk", "pubs", "fitness", "shops",
    ],
    company: ["solo", "couple", "family", "friends"],
    intent: [
      "any",
      "scenic",
      "walk",
      "unusual",
      "relax",
      "culture",
      "active",
      "food",
      "date",
      "kids",
    ],
    environment: ["any", "indoor", "outdoor"],
    travelMode: ["drive", "walk"],
    mode: ["normal", "surprise"],
  };
  for (const key of Object.keys(enums) as (keyof typeof enums)[]) {
    if (typeof p[key] === "string" && enums[key].includes(p[key] as string))
      Object.assign(q, { [key]: p[key] });
  }
  if (Array.isArray(p.includeCategories)) q.includeCategories = p.includeCategories.filter((v): v is "food" | "pubs" | "fitness" | "shops" => ["food","pubs","fitness","shops"].includes(String(v))).slice(0,4);
  if (Array.isArray(p.interests)) q.interests = p.interests.filter((v): v is DiscoveryQuery["intent"] => enums.intent.includes(String(v))).slice(0,8);
  if (typeof p.strictSuitability === "boolean") q.strictSuitability = p.strictSuitability;
  if (p.accessNeeds && typeof p.accessNeeds === "object") {
    const needs = p.accessNeeds as Record<string, unknown>;
    q.accessNeeds = {wheelchair: needs.wheelchair === true, stepFree:needs.stepFree === true,dogs:needs.dogs === true};
  }
  return q;
}
const strings = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string").slice(0, 500)
    : [];
export class LocalPersistence implements PreferenceStore {
  available = true;
  private memory = emptyState();
  constructor(private storage: Pick<Storage, "getItem" | "setItem"> | null) {}
  read(): LocalState {
    if (!this.available) return this.memory;
    try {
      const raw = this.storage?.getItem("sidequest:v1");
      if (!raw) return this.memory;
      const d = JSON.parse(raw);
      if (!d || d.version !== 1) return this.memory;
      const state = emptyState();
      state.saved = strings(d.saved);
      state.recent = strings(d.recent);
      state.impressions = Array.isArray(d.impressions) ? d.impressions.filter((v: Record<string,unknown>) => v && typeof v.id === "string" && typeof v.date === "string" && Number.isFinite(Date.parse(v.date))).slice(-200) : [];
      state.visits = Array.isArray(d.visits)
        ? d.visits
            .filter(
              (v: Record<string, unknown>) =>
                v &&
                typeof v.id === "string" &&
                typeof v.date === "string" &&
                Number.isFinite(Date.parse(v.date)) &&
                ["Loved it", "Good", "Meh", "Not again"].includes(
                  String(v.reaction),
                ) &&
                typeof v.note === "string" &&
                typeof v.km === "number",
            )
            .slice(0, 500)
        : [];
      state.dismissed = Array.isArray(d.dismissed)
        ? d.dismissed
            .filter(
              (v: Record<string, unknown>) =>
                v &&
                typeof v.id === "string" &&
                typeof v.reason === "string" &&
                typeof v.date === "string",
            )
            .slice(0, 500)
        : [];
      const cs = Array.isArray(d.collections)
        ? d.collections
            .filter(
              (v: Record<string, unknown>) =>
                v &&
                typeof v.id === "string" &&
                typeof v.name === "string" &&
                Array.isArray(v.places),
            )
            .map((v: { id: string; name: string; places: unknown }) => ({
              ...v,
              places: strings(v.places),
            }))
        : [];
      if (cs.length) state.collections = cs;
      state.preferences = validatedPreferences(d.preferences);
      state.plans = Array.isArray(d.plans)
        ? d.plans
            .filter(
              (v: Record<string, unknown>) =>
                v &&
                typeof v.id === "string" &&
                Array.isArray(v.stops) &&
                typeof v.minutes === "number" &&
                v.origin &&
                typeof v.origin === "object" &&
                typeof (v.origin as Record<string, unknown>).name ===
                  "string" &&
                typeof v.start === "string" &&
                typeof v.created === "string" &&
                Number.isFinite(Date.parse(v.created)) &&
                v.query &&
                typeof v.query === "object" &&
                v.stops.every(
                  (stop: Record<string, unknown>) =>
                    stop &&
                    typeof stop.name === "string" &&
                    typeof stop.at === "string" &&
                    typeof stop.type === "string" &&
                    stop.coordinates &&
                    typeof stop.coordinates === "object",
                ),
            )
            .slice(0, 30)
            .map((plan: Itinerary) => ({
              ...plan,
              query: { ...DEFAULT_QUERY, ...validatedPreferences(plan.query) },
            }))
        : [];
      this.memory = state;
      return state;
    } catch {
      this.available = false;
      return this.memory;
    }
  }
  write(state: LocalState) {
    this.memory = state;
    try {
      if (!this.storage) {
        this.available = false;
        return false;
      }
      this.storage.setItem("sidequest:v1", JSON.stringify(state));
      return true;
    } catch {
      this.available = false;
      return false;
    }
  }
}
