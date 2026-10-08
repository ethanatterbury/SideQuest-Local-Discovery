import type {
  Place,
  DiscoveryQuery,
  Environment,
  LocalState,
  Recommendation,
  OpeningStatus,
} from "./models";
import { estimatedRouting } from "../providers/routing";
import { addMinutes, isDark, londonParts } from "./time";
export function openingStatus(place: Place, now: string): OpeningStatus {
  if (!place.hours?.length)
    return { status: "unknown", label: "Check opening times" };
  const { day, minutes } = londonParts(now);
  const windows = place.hours.filter((w) => w.days.includes(day));
  const open = windows.find((w) => minutes >= w.open && minutes < w.close);
  if (open) {
    const remaining = open.close - minutes;
    return {
      status: remaining < 60 ? "closes-soon" : "open",
      remaining,
      label: remaining < 60 ? "Closes soon" : "Open at arrival",
    };
  }
  return {
    status: windows.some((w) => w.open > minutes) ? "opens-later" : "closed",
    label: windows.some((w) => w.open > minutes)
      ? "Opens later"
      : "Closed at arrival",
  };
}
export function matchesActivity(
  place: Place,
  activity: DiscoveryQuery["activity"],
): boolean {
  const category = place.category.toLowerCase().replace(/[-_]/g, " ");
  const features = (place.familyFeatures ?? []).map((feature) =>
    feature.toLowerCase().replace(/[-_]/g, " "),
  );
  const has = (pattern: RegExp) =>
    pattern.test(category) || features.some((feature) => pattern.test(feature));
  switch (activity) {
    case "soft-play":
      return has(/\bsoft\s*play\b/);
    case "playground":
      return has(/\bplayground\b/);
    case "museum":
      return has(/\bmuseum\b|\bgallery\b/);
    case "cinema":
      return has(/\bcinema\b/);
    case "animals":
      return has(/\bzoo\b|\baquarium\b|\banimal/);
    case "gardens":
      return has(/\bgardens?\b|\bpark\b/);
    case "climbing":
      return has(/\bclimb|\bbouldering\b/);
    case "swimming":
      return has(/\bswim|\bpool\b/);
    case "food":
      return place.intents.includes("food");
    case "walk":
      return place.intents.includes("walk");
    default:
      return true;
  }
}
export function rankPlaces(
  places: Place[],
  query: DiscoveryQuery,
  env: Environment,
  state: LocalState,
): Recommendation[] {
  if (env.failures.includes("empty") || env.failures.includes("places"))
    return [];
  const rainy =
      ["light-rain", "heavy-rain", "snow", "thunderstorm"].includes(
        env.weather.kind,
      ) || env.weather.rain > 0,
    severe =
      ["thunderstorm", "high-wind"].includes(env.weather.kind) ||
      env.weather.wind >= 60;
  const weatherKnown =
    !env.failures.includes("weather") && env.weather.source !== "unavailable";
  const likedCategories = state.visits
    .filter((v) => v.reaction === "Loved it")
    .map((v) => places.find((p) => p.id === v.id)?.category);
  return places
    .flatMap((place) => {
      if (!matchesActivity(place, query.activity)) return [];
      const family = query.company === "family" || query.intent === "kids";
      const ages = query.childrenAges ?? [];
      if (
        family &&
        ages.length &&
        place.ageRange &&
        ages.some((age) => age < place.ageRange![0] || age > place.ageRange![1])
      )
        return [];
      const features = place.familyFeatures ?? [];
      const familyText = `${place.category} ${place.name}`.toLowerCase();
      const softPlay =
        features.includes("soft-play") || /soft[ -]?play/.test(familyText);
      const playground =
        features.includes("playground") || /playground/.test(familyText);
      const museum = features.includes("museum") || /museum/.test(familyText);
      const familyPoints = family
        ? (softPlay || playground || museum || place.intents.includes("kids")
            ? 6
            : 0) +
          (ages.some((age) => age <= 5) &&
          (softPlay || features.includes("toddler-friendly"))
            ? 8
            : 0) +
          (ages.some((age) => age >= 6) &&
          (playground ||
            museum ||
            features.includes("hands-on") ||
            features.includes("sports"))
            ? 5
            : 0)
        : 0;
      const route = estimatedRouting.estimate(
        env.location,
        place.coordinates,
        query.travelMode,
      );
      const arrival = addMinutes(env.now, route.minutes);
      const opening = openingStatus(place, arrival);
      if (
        route.minutes > query.travel ||
        route.minutes * 2 + place.duration[0] > query.minutes
      )
        return [];
      if (
        (place.cost !== null && place.cost > query.budget) ||
        (query.budget === 0 && place.cost === null)
      )
        return [];
      if (
        query.environment !== "any" &&
        place.environment !== query.environment &&
        place.environment !== "mixed"
      )
        return [];
      if (
        place.daylightOnly &&
        (isDark(arrival, env.weather.sunrise, env.weather.sunset) ||
          new Date(addMinutes(arrival, place.duration[0])).getTime() >
            new Date(env.weather.sunset).getTime())
      )
        return [];
      if (weatherKnown && severe && place.environment === "outdoor") return [];
      if (
        weatherKnown &&
        (env.weather.kind === "fog" || env.weather.visibility < 1) &&
        place.exposed
      )
        return [];
      if (
        opening.status === "closed" ||
        opening.status === "opens-later" ||
        (opening.remaining !== undefined &&
          opening.remaining < place.duration[0])
      )
        return [];
      const permanent = state.dismissed.some(
        (d) => d.id === place.id && d.reason === "Not my thing",
      );
      if (permanent) return [];
      const temporary = state.dismissed.some(
        (d) =>
          d.id === place.id &&
          new Date(env.now).getTime() - new Date(d.date).getTime() < 86400000,
      );
      if (temporary) return [];
      const visited = state.visits.filter((v) => v.id === place.id);
      const recentVisit = visited.some(
        (v) =>
          new Date(env.now).getTime() - new Date(v.date).getTime() <
          14 * 86400000,
      );
      const outdoor = place.environment === "outdoor";
      const weatherPoints = !weatherKnown
        ? 10
        : rainy
          ? outdoor
            ? 2
            : 20
          : env.weather.kind === "heat" || env.weather.temperature >= 28
            ? place.exposed
              ? 6
              : 18
            : outdoor
              ? 20
              : 14;
      const components = {
        weather: weatherPoints,
        family: familyPoints,
        distance: Math.round(18 * (1 - route.minutes / (query.travel * 1.5))),
        time: 15,
        opening: opening.status === "unknown" ? 5 : 12,
        intent:
          query.intent === "any"
            ? 10
            : place.intents.includes(query.intent)
              ? 15
              : 3,
        budget: place.cost === null ? 4 : 9,
        company: place.company.includes(query.company) ? 6 : 2,
        novelty: Math.round(
          (query.mode === "surprise" ? 14 : 8) *
            (visited.length ? 0.15 : place.novelty),
        ),
        history: visited.some((v) => v.reaction === "Not again")
          ? -22
          : visited.some((v) => v.reaction === "Meh")
            ? -10
            : recentVisit
              ? -25
              : likedCategories.includes(place.category)
                ? 3
                : 0,
        season: place.season?.includes(new Date(env.now).getMonth() + 1)
          ? 3
          : 0,
      };
      const score = Math.max(
        0,
        Math.min(
          99,
          Math.round(
            (Object.values(components).reduce((a, b) => a + b, 0) /
              (query.mode === "surprise" ? 115 : 109)) *
              100,
          ),
        ),
      );
      const weatherReason = !weatherKnown
        ? "Weather unavailable; check the forecast before heading out."
        : rainy
          ? outdoor
            ? "A shorter outdoor option. Take a waterproof."
            : "Keep the plans, skip the rain. This one has shelter."
          : env.weather.kind === "heat" || env.weather.temperature >= 28
            ? "Take water and avoid the hottest part of the day."
            : isDark(env.now, env.weather.sunrise, env.weather.sunset)
              ? "An indoor option for after dark."
              : outdoor
                ? "A little fresh air fits the conditions."
                : "An easy change of scene, whatever the sky does.";
      const reasons = [
        `${route.minutes} min ${query.travelMode === "walk" ? "walk" : "drive"} estimate`,
        place.costLabel,
        `${place.duration[0]}–${place.duration[1]} min visit`,
        opening.label,
      ];
      if (family)
        reasons.push(
          ages.length && place.ageRange
            ? place.ageRange[1] === 99
              ? `Venue reports minimum age ${place.ageRange[0]}; confirm other limits`
              : place.ageRange[0] === 0
                ? `Venue reports an upper age limit ${place.ageRange[1]}; check minimum age`
                : `Venue age guidance: ${place.ageRange[0]}–${place.ageRange[1]} years; includes all entered ages`
            : "Check age suitability with the venue",
        );
      const explanation = `${weatherReason} ${route.minutes <= 15 ? "Close enough to make a quick escape." : `About ${route.minutes} minutes away.`} ${query.mode === "surprise" ? "A little less obvious, and still a sensible fit." : recentVisit ? "You have been here recently." : place.tagline}`;
      return [
        {
          place,
          score,
          travel: route.minutes,
          km: route.km,
          explanation,
          components,
          opening,
          reasons,
        },
      ];
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.travel - b.travel ||
        a.place.id.localeCompare(b.place.id),
    );
}
export function parseIntent(
  text: string,
  base: DiscoveryQuery,
): DiscoveryQuery {
  const s = text.toLowerCase();
  const q = { ...base, text };
  if (/indoors?|rain|museum|soft[ -]?play/.test(s)) q.environment = "indoor";
  if (/outdoors?/.test(s)) q.environment = "outdoor";
  if (/kids|children|family|toddlers?|soft[ -]?play/.test(s)) {
    q.company = "family";
    q.intent = "kids";
  }
  if (/date|romantic/.test(s)) {
    q.company = "couple";
    q.intent = "date";
  }
  if (/walk|woodland/.test(s)) q.intent = "walk";
  if (/scenic|beautiful|lake|garden/.test(s)) q.intent = "scenic";
  if (/weird|different|unusual|hidden/.test(s)) q.intent = "unusual";
  if (/art|gallery|museum|culture/.test(s)) q.intent = "culture";
  if (/coffee|food|eat/.test(s)) q.intent = "food";
  if (/climb|active|move/.test(s)) q.intent = "active";
  if (/kids|children|family|toddlers?|soft[ -]?play/.test(s)) {
    q.company = "family";
    q.intent = "kids";
  }
  const activities: [NonNullable<DiscoveryQuery["activity"]>, RegExp][] = [
    ["soft-play", /\bsoft[ -]?play\b/],
    ["playground", /\bplaygrounds?\b/],
    ["museum", /\bmuseums?\b|\bgallery\b/],
    ["cinema", /\bcinema\b/],
    ["animals", /\bzoo\b|\baquarium\b|\banimals?\b/],
    ["gardens", /\bgardens?\b/],
    ["climbing", /\bclimbing\b|\bbouldering\b/],
    ["swimming", /\bswimming\b|\bpool\b/],
    ["food", /\bfood\b|\bcoffee\b/],
    ["walk", /\bwalk(?:s|ing)?\b|\bwoodland\b/],
  ];
  const activity = activities.find(([, pattern]) => pattern.test(s));
  if (activity) q.activity = activity[0];
  const agePhrase = s.match(
    /(?:ages?|aged)\s+(\d{1,2}(?:\s*(?:,|and|&)\s*\d{1,2})*)\b/,
  );
  const yearOld = [
    ...s.matchAll(/\b(\d{1,2})[ -](?:year[ -]olds?|years? old)\b/g),
  ];
  const specifiedAges = agePhrase
    ? agePhrase[1].match(/\d+/g)?.map(Number)
    : yearOld.map((match) => Number(match[1]));
  if (
    specifiedAges?.length &&
    specifiedAges.length <= 8 &&
    specifiedAges.every((age) => age <= 17)
  ) {
    q.childrenAges = specifiedAges;
    q.company = "family";
    q.intent = "kids";
  }
  if (/free/.test(s)) q.budget = 0;
  else if (/cheap/.test(s)) q.budget = 15;
  const budget = s.match(/£(\d+)/);
  if (budget) q.budget = Math.min(200, Number(budget[1]));
  const hours = s.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)/);
  if (hours) q.minutes = Math.min(720, Math.max(30, Number(hours[1]) * 60));
  const travel = s.match(
    /(?:within|under|less than)\s*(\d+)\s*(?:minutes?|mins?)/,
  );
  if (travel) q.travel = Math.min(120, Math.max(5, Number(travel[1])));
  return q;
}
