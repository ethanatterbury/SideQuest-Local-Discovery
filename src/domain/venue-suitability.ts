import type { Activity, Company, DiscoveryQuery, Place } from "./models";

export type VenueSuitability = {
  kind:
    | "child-play"
    | "nature"
    | "culture"
    | "animals"
    | "cinema"
    | "food"
    | "fitness"
    | "adventure"
    | "swimming"
    | "leisure"
    | "general";
  activities: Activity[];
  audience: "children" | "all" | "adults" | "unknown";
  ageGuidance: "reported" | "unknown";
  requiresAgeCheck: boolean;
  source: "osm" | "inferred";
};

/** Category and mapped facilities are evidence; venue names and photos are not. */
export function inferVenueSuitability(
  place: Pick<Place, "category" | "intents" | "familyFeatures" | "ageRange">,
): VenueSuitability {
  const category = place.category.toLowerCase().replace(/[-_]/g, " ");
  const features = (place.familyFeatures ?? []).map((feature) =>
    feature.toLowerCase().replace(/[-_]/g, " "),
  );
  const has = (pattern: RegExp) =>
    pattern.test(category) || features.some((feature) => pattern.test(feature));
  let kind: VenueSuitability["kind"] = "general";
  let audience: VenueSuitability["audience"] = "unknown";
  let requiresAgeCheck = false;
  const activities: Activity[] = [];
  // Specific restrictions take precedence over broad words such as "park" or "playground".
  if (has(/\bfitness\b|\bgym\b|\bhealth club\b|\bweightlifting\b/)) {
    kind = "fitness";
    audience = "adults";
  } else if (
    has(
      /\bwater park\b|\btrampoline\b|\btheme park\b|\bwake(?:board|boarding)?\b|\bwater ?ski\b|\bwater ?sports?\b|\bkarting\b|\bclimb|\bbouldering\b|\badventure\b/,
    )
  ) {
    kind = "adventure";
    audience = "all";
    requiresAgeCheck = true;
    if (has(/\bclimb|\bbouldering\b/)) activities.push("climbing");
  } else if (has(/\bsoft\s*play\b|\bindoor play\b|\bplayground\b/)) {
    kind = "child-play";
    audience = "children";
    if (has(/\bsoft\s*play\b|\bindoor play\b/)) activities.push("soft-play");
    if (has(/\bplayground\b/)) activities.push("playground");
  } else if (has(/\bswim|\bpool\b/)) {
    kind = "swimming";
    audience = "all";
    requiresAgeCheck = true;
    activities.push("swimming");
  } else if (
    has(/\bmuseum\b|\bgallery\b|\bart(?:s)?(?: &| and)? culture\b|\bheritage\b/)
  ) {
    kind = "culture";
    audience = "all";
    activities.push("museum");
  } else if (has(/\bzoo\b|\baquarium\b|\banimals?\b/)) {
    kind = "animals";
    audience = "all";
    activities.push("animals");
  } else if (has(/\bcinema\b/)) {
    kind = "cinema";
    audience = "all";
    activities.push("cinema");
  } else if (
    !/\bbusiness park\b|\bindustrial park\b|\bcar park\b/.test(category) &&
    has(
      /\bgardens?\b|\bpark\b|\bnature reserve\b|\bwoodland\b|\bforest\b|\bwalk\b|\bviewpoint\b|\blake(?:side)?\b|\bpond\b/,
    )
  ) {
    kind = "nature";
    audience = "all";
    activities.push("gardens");
    if (place.intents.includes("walk")) activities.push("walk");
  } else if (place.intents.includes("food")) {
    kind = "food";
    audience = "all";
    activities.push("food");
  } else if (
    has(
      /\bbowling\b|\bminiature golf\b|\bescape game\b|\bsports centre\b|\btheatre\b|\barts centre\b/,
    )
  ) {
    kind = "leisure";
    audience = "all";
    requiresAgeCheck = has(/\bescape game\b|\bsports centre\b/);
  }
  return {
    kind,
    activities,
    audience,
    ageGuidance: place.ageRange ? "reported" : "unknown",
    requiresAgeCheck,
    source: "inferred",
  };
}

export function venueSuitability(place: Place): VenueSuitability {
  return place.suitability ?? inferVenueSuitability(place);
}

export function childActivityRequested(query: DiscoveryQuery): boolean {
  return (
    query.intent === "kids" ||
    query.activity === "soft-play" ||
    query.activity === "playground"
  );
}

export function effectiveCompany(place: Place): Company[] {
  const suitability = venueSuitability(place);
  if (suitability.audience === "children") return ["family"];
  if (suitability.audience === "all")
    return ["solo", "couple", "family", "friends"];
  if (suitability.audience === "adults") return ["solo", "couple", "friends"];
  return place.company;
}

/** Kids is a child-oriented outing, not any record carrying a generic family tag. */
export function isChildOuting(place: Place): boolean {
  const { kind } = venueSuitability(place);
  return (
    kind === "child-play" ||
    (["nature", "culture", "animals"].includes(kind) &&
      place.intents.includes("kids"))
  );
}

export function isSuitableForQuery(
  place: Place,
  query: DiscoveryQuery,
): boolean {
  const suitability = venueSuitability(place);
  const children = query.company === "family" || childActivityRequested(query);
  const ages = children ? (query.childrenAges ?? []) : [];
  // Membership training is not a default outing, including for an "active" mood.
  if (suitability.kind === "fitness") return false;
  if (suitability.audience === "children" && !children) return false;
  if (
    !effectiveCompany(place).includes(query.company) &&
    !(suitability.audience === "children" && childActivityRequested(query))
  )
    return false;
  if (
    children &&
    place.ageRange &&
    ages.some((age) => age < place.ageRange![0] || age > place.ageRange![1])
  )
    return false;
  // Missing restrictions on adrenaline/swimming activities cannot establish eligibility for children.
  // A reported upper bound alone (minimum sentinel 0) is also insufficient.
  if (
    children &&
    suitability.requiresAgeCheck &&
    (!ages.length || !place.ageRange || place.ageRange[0] === 0)
  )
    return false;
  if (children && suitability.audience === "adults") return false;
  return true;
}

export function changeCompany(
  query: DiscoveryQuery,
  company: Company,
): DiscoveryQuery {
  const childActivity =
    query.activity === "soft-play" || query.activity === "playground";
  const childText =
    /\bkids?\b|\bchildren\b|\bfamily\b|\btoddlers?\b|\bsoft[ -]?play\b|\bplaygrounds?\b|\b(?:ages?|aged)\b|\byear[ -]old/.test(
      query.text.toLowerCase(),
    );
  const dateText = /\bdate\b|\bromantic\b/.test(query.text.toLowerCase());
  return {
    ...query,
    company,
    childrenAges: company === "family" ? query.childrenAges : undefined,
    intent:
      (query.intent === "kids" && company !== "family") ||
      (query.intent === "date" && company !== "couple")
        ? "any"
        : query.intent,
    activity: childActivity && company !== "family" ? "any" : query.activity,
    // Explicit company choices must not be silently undone by an earlier semantic search.
    text:
      (company !== "family" && childText) || (company !== "couple" && dateText)
        ? ""
        : query.text,
  };
}

export function changeActivity(
  query: DiscoveryQuery,
  activity: Activity,
): DiscoveryQuery {
  return {
    ...query,
    activity,
    intent:
      activity === "soft-play" || activity === "playground"
        ? "kids"
        : query.intent === "kids" && query.company !== "family"
          ? "any"
          : query.intent,
    text: "",
  };
}
