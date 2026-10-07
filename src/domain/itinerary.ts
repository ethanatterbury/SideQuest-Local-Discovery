import type {
  Place,
  DiscoveryQuery,
  Environment,
  LocalState,
  Itinerary,
  ItineraryStop,
} from "./models";
import { rankPlaces, openingStatus } from "./discovery";
import { estimatedRouting, distanceKm } from "../providers/routing";
import { addMinutes, isDark } from "./time";
function visitWindow(place: Place, arrival: string, env: Environment): number {
  const opening = openingStatus(place, arrival);
  if (opening.status === "closed" || opening.status === "opens-later") return 0;
  let remaining = opening.remaining ?? Infinity;
  if (place.daylightOnly) {
    if (isDark(arrival, env.weather.sunrise, env.weather.sunset)) return 0;
    remaining = Math.min(
      remaining,
      Math.floor(
        (new Date(env.weather.sunset).getTime() - new Date(arrival).getTime()) /
          60000,
      ),
    );
  }
  return remaining;
}
export function buildItinerary(
  places: Place[],
  query: DiscoveryQuery,
  env: Environment,
  state: LocalState,
  options: { food: boolean; skip?: string[]; start?: string },
): Itinerary | null {
  const start = options.start || env.now;
  const ranked = rankPlaces(
    places,
    query,
    { ...env, now: start },
    state,
  ).filter((r) => !options.skip?.includes(r.place.id));
  if (!ranked.length) return null;
  const first = ranked[0];
  const stops: ItineraryStop[] = [
    {
      type: "leave",
      name: `Leave ${env.location.name}`,
      at: start,
      minutes: first.travel,
      cost: 0,
      coordinates: env.location,
    },
  ];
  let elapsed = first.travel;
  let cost = first.place.cost || 0;
  let unknownCost = first.place.cost === null;
  let current = first.place.coordinates;
  let currentPlace = first.place;
  const pushPlace = (p: Place, visit: number) => {
    stops.push({
      type: "place",
      name: p.name,
      placeId: p.id,
      at: addMinutes(start, elapsed),
      minutes: visit,
      cost: p.cost || 0,
      unknownCost: p.cost === null,
      coordinates: p.coordinates,
    });
    elapsed += visit;
  };
  const reserve = options.food ? 30 : 0;
  const visit = Math.min(
    first.place.duration[1],
    visitWindow(first.place, addMinutes(start, elapsed), env),
    Math.max(
      first.place.duration[0],
      query.minutes - first.travel * 2 - reserve,
    ),
  );
  if (visit < first.place.duration[0]) return null;
  pushPlace(first.place, visit);
  const second = ranked.slice(1).find((r) => {
    const leg = estimatedRouting.estimate(
        current,
        r.place.coordinates,
        query.travelMode,
      ).minutes,
      back = estimatedRouting.estimate(
        r.place.coordinates,
        env.location,
        query.travelMode,
      ).minutes;
    const arrival = addMinutes(start, elapsed + leg);
    return (
      distanceKm(current, r.place.coordinates) < 8 &&
      elapsed + leg + r.place.duration[0] + back + reserve <= query.minutes &&
      cost + (r.place.cost || 0) <= query.budget &&
      visitWindow(r.place, arrival, env) >= r.place.duration[0]
    );
  });
  if (second) {
    elapsed += estimatedRouting.estimate(
      current,
      second.place.coordinates,
      query.travelMode,
    ).minutes;
    pushPlace(second.place, second.place.duration[0]);
    cost += second.place.cost || 0;
    unknownCost ||= second.place.cost === null;
    current = second.place.coordinates;
    currentPlace = second.place;
  }
  const home = estimatedRouting.estimate(
    current,
    env.location,
    query.travelMode,
  ).minutes;
  if (
    options.food &&
    elapsed + 30 + home <= query.minutes &&
    visitWindow(currentPlace, addMinutes(start, elapsed), env) >= 30
  ) {
    const allowance = Math.min(12, Math.max(0, query.budget - cost));
    stops.push({
      type: "break",
      name: allowance ? "A coffee or picnic break" : "Bring a picnic",
      at: addMinutes(start, elapsed),
      minutes: 30,
      cost: allowance,
      coordinates: current,
    });
    cost += allowance;
    elapsed += 30;
  }
  elapsed += home;
  stops.push({
    type: "home",
    name: "Back home",
    at: addMinutes(start, elapsed),
    minutes: 0,
    cost: 0,
    coordinates: env.location,
  });
  return {
    id: `plan-${new Date(start).getTime()}-${first.place.id}`,
    created: env.now,
    start,
    stops,
    minutes: elapsed,
    cost,
    unknownCost,
    query,
    origin: env.location,
  };
}
