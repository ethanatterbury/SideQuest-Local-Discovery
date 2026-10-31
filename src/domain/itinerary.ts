import type {
  Place,
  DiscoveryQuery,
  Environment,
  LocalState,
  Itinerary,
  ItineraryStop,
} from "./models";
import {
  effectiveDiscoveryQuery,
  rankPlaces,
  openingStatus,
} from "./discovery";
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
        (Date.parse(env.weather.sunset) - Date.parse(arrival)) / 60000,
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
  query = effectiveDiscoveryQuery(query, places);
  const available = places.filter((p) => !options.skip?.includes(p.id));
  const ranked = rankPlaces(available, query, { ...env, now: start }, state);
  const first = ranked.find(
    (r) =>
      visitWindow(r.place, addMinutes(start, r.travel), env) >=
      r.place.duration[0],
  );
  if (!first) return null;
  const route = (from: Place["coordinates"], to: Place["coordinates"]) =>
    estimatedRouting.estimate(from, to, query.travelMode).minutes;
  const firstArrival = addMinutes(start, first.travel);
  const firstMinimum = first.place.duration[0];
  const afterFirst = first.travel + firstMinimum;
  const firstHome = route(first.place.coordinates, env.location);
  // A break is optional: never discard a worthwhile visit just because it cannot fit.
  const reserve =
    options.food &&
    afterFirst + firstHome + 30 <= query.minutes &&
    visitWindow(first.place, addMinutes(start, afterFirst), env) >= 30
      ? 30
      : 0;
  const second = rankPlaces(
    available.filter((p) => p.id !== first.place.id),
    {
      ...query,
      // Discovery assumes a return to its origin. This leg continues toward
      // home instead; enforce the actual remaining journey in the check below.
      minutes: Infinity,
      budget: query.budget - (first.place.cost ?? 0),
    },
    {
      ...env,
      location: { ...first.place.coordinates, name: first.place.name },
      now: addMinutes(start, afterFirst),
    },
    state,
  ).find((r) => {
    const home = route(r.place.coordinates, env.location);
    const arrival = addMinutes(start, afterFirst + r.travel);
    return (
      home <= query.travel &&
      distanceKm(first.place.coordinates, r.place.coordinates) < 8 &&
      afterFirst + r.travel + r.place.duration[0] + home + reserve <=
        query.minutes &&
      visitWindow(r.place, arrival, env) >= r.place.duration[0] + reserve
    );
  });
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
  const pushPlace = (p: Place, visit: number) => {
    stops.push({
      type: "place",
      name: p.name,
      placeId: p.id,
      at: addMinutes(start, elapsed),
      minutes: visit,
      cost: p.cost ?? 0,
      unknownCost: p.cost === null,
      coordinates: p.coordinates,
    });
    elapsed += visit;
  };
  let current = first.place;
  if (second) {
    // Book meaningful minimum visits first; share spare time across both stops.
    const home = route(second.place.coordinates, env.location);
    const spare =
      query.minutes -
      afterFirst -
      second.travel -
      second.place.duration[0] -
      home -
      reserve;
    const firstExtra = Math.min(
      Math.floor(spare / 2),
      first.place.duration[1] - firstMinimum,
      visitWindow(first.place, firstArrival, env) - firstMinimum,
      visitWindow(
        second.place,
        addMinutes(start, afterFirst + second.travel),
        env,
      ) -
        second.place.duration[0] -
        reserve,
    );
    pushPlace(first.place, firstMinimum + Math.max(0, firstExtra));
    elapsed += second.travel;
    const secondVisit = Math.min(
      second.place.duration[1],
      query.minutes - elapsed - home - reserve,
      visitWindow(second.place, addMinutes(start, elapsed), env) - reserve,
    );
    pushPlace(second.place, secondVisit);
    current = second.place;
  } else {
    const visit = Math.min(
      first.place.duration[1],
      query.minutes - first.travel - firstHome - reserve,
      visitWindow(first.place, firstArrival, env) - reserve,
    );
    if (visit < firstMinimum) return null;
    pushPlace(first.place, visit);
  }
  const home = route(current.coordinates, env.location);
  if (
    reserve &&
    visitWindow(current, addMinutes(start, elapsed), env) >= reserve &&
    elapsed + reserve + home <= query.minutes
  ) {
    stops.push({
      type: "break",
      name: "Bring-your-own picnic break",
      at: addMinutes(start, elapsed),
      minutes: reserve,
      cost: 0,
      coordinates: current.coordinates,
    });
    elapsed += reserve;
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
    id: `plan-${Date.parse(start)}-${first.place.id}`,
    created: env.now,
    start,
    stops,
    minutes: elapsed,
    cost: stops.reduce((sum, stop) => sum + stop.cost, 0),
    unknownCost: stops.some((stop) => stop.unknownCost),
    query,
    origin: env.location,
  };
}
