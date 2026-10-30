import type {
  Activity,
  Company,
  DiscoveryQuery,
  OptionalCategory,
  Place,
} from "./models";

/** Explicit adult-entertainment venues are outside ordinary outing discovery.
 * This exclusion does not infer an age rating for any other venue/session. */
export function isExplicitAdultVenue(
  place: Pick<Place, "name" | "category">,
): boolean {
  const label = `${place.name} ${place.category}`.replace(/[-_]/g, " ");
  return /\b(?:adult(?:\s+world)?\s+cinema|(?:erotic|porn(?:ographic)?)\s+(?:cinema|theatre|shop)|sex\s+(?:cinema|shop|club)|strip\s*club)\b/i.test(
    label,
  );
}

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
  source: "osm" | "official" | "inferred";
};

/** Category and mapped facilities are evidence; venue names and photos are not. */
export function inferVenueSuitability(
  place: Pick<Place, "category" | "intents" | "familyFeatures" | "ageRange">,
): VenueSuitability {
  const category = place.category
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[-_]/g, " ");
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
      /\bwater park\b|\btrampoline\b|\btheme park\b|\bamusement ride\b|\bwake(?:board|boarding)?\b|\bwater ?ski\b|\bwater ?sports?\b|\bkarting\b|\bclimb|\bbouldering\b|\badventure\b/,
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
      /\bgardens?\b|\bpark\b|\bnature reserve\b|\bwoodland\b|\bheath(?:land)?\b|\bforest\b|\bwalk\b|\bviewpoint\b|\blake(?:side)?\b|\bpond\b/,
    )
  ) {
    kind = "nature";
    audience = "all";
    activities.push("gardens");
    if (place.intents.includes("walk")) activities.push("walk");
  } else if (
    has(
      /\brestaurant\b|\bcaf[eé]\b|\bcoffee\b|\bice cream\b|\bfood\b|\bpub\b|\bbar\b/,
    )
  ) {
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
    requiresAgeCheck = has(
      /\bbowling\b|\bminiature golf\b|\bescape game\b|\bsports centre\b/,
    );
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

type Classification = Pick<Place, "category"> &
  Partial<
    Pick<
      Place,
      | "intents"
      | "familyFeatures"
      | "ageRange"
      | "suitability"
      | "optionalCategory"
      | "experiences"
    >
  >;
const experienceLabels: Partial<Record<Activity, string>> = {
  "soft-play": "Indoor soft play",
  playground: "Playground",
  museum: "Museum",
  cinema: "Cinema",
  animals: "Zoo",
  gardens: "Gardens",
  climbing: "Climbing",
  swimming: "Swimming",
  walk: "Walk",
};
export function primaryExperienceActivities(
  place: Pick<Classification, "experiences">,
): Activity[] {
  return [
    ...new Set(
      (place.experiences ?? []).flatMap((record) => {
        const e = record.evidence;
        if (
          !record.primary ||
          !["official", "osm", "wikidata"].includes(e.source) ||
          !["reported", "verified"].includes(e.confidence) ||
          !e.url?.startsWith("https://")
        )
          return [];
        return record.activities.filter(
          (activity) => experienceLabels[activity],
        );
      }),
    ),
  ];
}
export function venueSuitability(place: Classification): VenueSuitability {
  const primary = primaryExperienceActivities(place);
  if (primary.length) {
    const derived = inferVenueSuitability({
      category: primary.map((a) => experienceLabels[a]).join(" / "),
      intents: place.intents ?? [],
      ageRange: place.ageRange,
    });
    return {
      ...derived,
      activities: [...new Set([...derived.activities, ...primary])],
    };
  }
  const inferred = inferVenueSuitability({
    ...place,
    intents: place.intents ?? [],
  });
  // Cached/provider classifications cannot remove a restriction required by the current category rules.
  return place.suitability
    ? {
        ...place.suitability,
        requiresAgeCheck:
          place.suitability.requiresAgeCheck || inferred.requiresAgeCheck,
      }
    : inferred;
}

/** Opt-in categories use mapped categories, never venue names. */
export function optionalCategory(
  place: Classification,
): OptionalCategory | undefined {
  if (primaryExperienceActivities(place).length) return undefined;
  if (place.optionalCategory) return place.optionalCategory;
  const category = place.category
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[-_]/g, " ");
  if (/\bpubs?\b|\bbars?\b|\bnightclub\b/.test(category)) return "pubs";
  if (venueSuitability(place).kind === "fitness") return "fitness";
  if (
    venueSuitability(place).kind === "food" ||
    /\b(?:restaurants?|caf[eé]s?|coffee|ice cream|bakery|bakeries|bistro|brasserie|deli|diner|tea\s?rooms?|food|pizzeria|takeaway)\b/.test(
      category,
    )
  )
    return "food";
  if (/\bshops?\b|\bretail\b|\bshopping\b|\bsupermarket\b/.test(category))
    return "shops";
  return undefined;
}

export function categoryRequested(
  query: DiscoveryQuery,
  category: OptionalCategory,
): boolean {
  return Boolean(
    query.includeCategories?.includes(category) ||
    query.activity === category ||
    (category === "food" &&
      (query.intent === "food" || query.interests?.includes("food"))),
  );
}

export function childActivityRequested(query: DiscoveryQuery): boolean {
  return (
    query.intent === "kids" ||
    query.interests?.includes("kids") ||
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
  if (isExplicitAdultVenue(place)) return false;
  const suitability = venueSuitability(place);
  const children = query.company === "family" || childActivityRequested(query);
  const ages = children ? (query.childrenAges ?? []) : [];
  // Whole-park admission is distinct from eligibility to participate in its rides.
  // Use the mapped category, never a venue name or incidental play facilities.
  const wholeThemeParkVisit =
    /^(?:theme|amusement)[ _-]park$/i.test(place.category.trim()) &&
    (!query.activity || query.activity === "any") &&
    primaryExperienceActivities(place).length === 0;
  const optional = optionalCategory(place);
  if (optional && !categoryRequested(query, optional)) return false;
  if (place.access?.public === false) return false;
  // Requested access needs require positive evidence; missing and limited are not confirmations.
  for (const need of ["wheelchair", "stepFree", "dogs"] as const) {
    if (query.accessNeeds?.[need] && place.access?.[need] !== "yes")
      return false;
  }
  if (children && place.heightRange?.some((bound) => bound !== null))
    return false;
  if (ages.includes(0)) {
    const evidence = place.evidence?.infantSuitability;
    const infantExperience =
      evidence?.source === "official" &&
      evidence.confidence === "verified" &&
      /^https:\/\//.test(evidence.url ?? "") &&
      Number.isFinite(Date.parse(evidence.checkedAt ?? ""));
    // An infant accompanying a family visit differs from participating in an activity.
    // Generic play, all-ages labels, names and maximum-age sentinels do not establish infant suitability.
    // An incidental playground does not turn a museum or park visit into infant play.
    // Respect primary experience evidence, but ignore ancillary facilities for this decision.
    const visitKind = venueSuitability({
      ...place,
      familyFeatures: undefined,
      suitability: undefined,
    }).kind;
    const participating = ["soft-play", "playground", "cinema"].includes(
      query.activity ?? "any",
    );
    const familyVisit =
      !participating &&
      (wholeThemeParkVisit ||
        ["nature", "culture", "animals", "food"].includes(visitKind));
    const verifiedInfantActivity =
      ["child-play", "cinema", "general"].includes(suitability.kind) &&
      infantExperience;
    if (!familyVisit && !verifiedInfantActivity) return false;
  }
  if (children && query.strictSuitability && ages.length && !place.ageRange)
    return false;
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
    !wholeThemeParkVisit &&
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
    interests: query.interests?.filter(
      (interest) =>
        (interest !== "kids" || company === "family") &&
        (interest !== "date" || company === "couple"),
    ),
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
