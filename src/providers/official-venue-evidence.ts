import type { Coordinates, Place } from "@/domain/models";
import { safeOfficialPhotoUrl } from "./official-photo";
export type OfficialVenueQuery = {
  id: string;
  name: string;
  coordinates: Coordinates;
  postcode?: string;
  street?: string;
  area?: string;
  aliases?: string[];
};
export type OfficialVenuePage = { url: string; html: string };
export type OfficialVenueEvidence = {
  id: string;
  name: string;
  classification: "play-cafe";
  source: "official";
  url: string;
  checkedAt: string;
  identity: { matchedName: boolean; matchedLocation: boolean };
  quotes: string[];
  notes: string[];
};
function plain(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|svg|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(?:amp|nbsp|quot|apos|#39|#38);/gi,
      (entity) =>
        ({
          "&amp;": "&",
          "&nbsp;": " ",
          "&quot;": '\"',
          "&apos;": "'",
          "&#39;": "'",
          "&#38;": "&",
        })[entity.toLowerCase()] ?? " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}
function normal(value: string): string {
  return plain(value)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
function contains(text: string, value?: string): boolean {
  const needle = normal(value ?? "");
  return needle.length >= 3 && ` ${normal(text)} `.includes(` ${needle} `);
}
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function schemaObjects(html: string): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    const record = object(value);
    if (!record) return;
    result.push(record);
    for (const nested of Object.values(record))
      if (nested && typeof nested === "object") visit(nested);
  };
  for (const match of html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi,
  )) {
    try {
      visit(JSON.parse(match[1]));
    } catch {
      /* Malformed schema is not identity evidence. */
    }
  }
  return result;
}
function closeCoordinates(
  query: OfficialVenueQuery,
  record: Record<string, unknown>,
): boolean {
  const geo = object(record.geo);
  if (!geo) return false;
  const lat = Number(geo.latitude),
    lng = Number(geo.longitude);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  )
    return false;
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat - query.coordinates.lat) * rad) / 2) ** 2 +
    Math.cos(lat * rad) *
      Math.cos(query.coordinates.lat * rad) *
      Math.sin(((lng - query.coordinates.lng) * rad) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a)) <= 0.2;
}
function identity(query: OfficialVenueQuery, page: OfficialVenuePage) {
  const names = [query.name, ...(query.aliases ?? [])];
  const objects = schemaObjects(page.html);
  const named = objects.filter(
    (record) =>
      typeof record.name === "string" &&
      names.some((name) => contains(record.name as string, name)),
  );
  const headings = [
    ...page.html.matchAll(/<(?:title|h1)\b[^>]*>([\s\S]*?)<\/(?:title|h1)>/gi),
  ]
    .map((match) => plain(match[1]))
    .join(" ");
  const matchedName =
    named.length > 0 || names.some((name) => contains(headings, name));
  const text = plain(page.html);
  // Mixed-location footers cannot establish which branch owns the play experience.
  const postcodes = [
    ...new Set(
      (
        text.match(/\b(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/gi) ??
        []
      ).map((value) => normal(value).replace(/ /g, "")),
    ),
  ];
  const expectedPostcode = normal(query.postcode ?? "").replace(/ /g, "");
  const conflictingLocation =
    postcodes.length > 1 ||
    (!!expectedPostcode &&
      postcodes.some((value) => value !== expectedPostcode)) ||
    (named.some((record) => object(record.geo)) &&
      !named.some((record) => closeCoordinates(query, record)));
  const matchedPostcode =
    !!expectedPostcode && postcodes.includes(expectedPostcode);
  const matchedLocation =
    !conflictingLocation &&
    (matchedPostcode ||
      named.some((record) => closeCoordinates(query, record)));
  const multiBranch =
    postcodes.length > 1 ||
    objects.filter((record) => object(record.geo)).length > 1 ||
    /\b(?:our locations|find (?:your|a) (?:nearest )?(?:branch|location)|store locator)\b/i.test(
      text,
    );
  return {
    matchedName,
    matchedLocation,
    multiBranch,
    conflictingLocation,
    postcodes,
  };
}

/** Only visible, specific play facilities paired with play-session booking establish a primary outing. */
function playQuotes(html: string): string[] {
  const text = plain(html);
  const sentences = text.split(/(?<=[.!?])\s+|[\r\n]+/).filter(Boolean);
  const facility =
    /\b(?:indoor|dedicated|purpose built|themed)\b.{0,90}\b(?:soft play|role play|play village|play frame|playground|sensory room)\b|\b(?:soft play (?:centre|center|frame)|role play (?:village|town|centre|center))\b/i;
  const booking =
    /\b(?:book|reserve|booking|bookable|tickets? for)\b.{0,65}\b(?:play (?:sessions?|admission)|(?:soft|role|sensory) play|stay and play)\b|\bplay sessions?\b.{0,65}\b(?:book|reserve|tickets?|booking|bookable)\b/i;
  const negative =
    /\b(?:no longer|do not|does not|don't|doesn't|not available|closed|closing|removed|no (?:indoor |soft |role )?play)\b/i;
  const minor =
    /\b(?:small|little|tiny|toy|kids'?|children'?s?)\s+(?:(?:soft|indoor)\s+play\s+)?corner\b|\bincidental\b/i;
  const substantial = sentences.find(
    (sentence) =>
      facility.test(sentence) &&
      !negative.test(sentence) &&
      !minor.test(sentence),
  );
  const admission = sentences.find(
    (sentence) => booking.test(sentence) && !negative.test(sentence),
  );
  if (
    !substantial ||
    !admission ||
    !/\b(?:children|child|kids|toddlers?|babies|baby|families)\b/i.test(text)
  )
    return [];
  return [...new Set([substantial.slice(0, 700), admission.slice(0, 700)])];
}

/** Candidate URLs are discovery hints; both venue identity and primary play must be established by official content. */
export function analyseOfficialVenueEvidence(
  query: OfficialVenueQuery,
  pages: OfficialVenuePage[],
  checkedAt: string,
): OfficialVenueEvidence | null {
  if (
    !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(checkedAt) ||
    !Number.isFinite(Date.parse(checkedAt)) ||
    !Number.isFinite(query.coordinates.lat) ||
    !Number.isFinite(query.coordinates.lng)
  )
    return null;
  const valid = pages.filter(
    (page) => safeOfficialPhotoUrl(page.url) && page.html.length <= 2_000_000,
  );
  const home = valid.find((page) => {
    const found = identity(query, page);
    return found.matchedName && found.matchedLocation;
  });
  if (!home) return null;
  const homeIdentity = identity(query, home);
  const localQuery = query.postcode
    ? query
    : { ...query, postcode: homeIdentity.postcodes[0] };
  for (const page of valid) {
    if (new URL(page.url).origin !== new URL(home.url).origin) continue;
    const local = identity(localQuery, page);
    if (local.multiBranch || local.conflictingLocation) continue;
    if (
      homeIdentity.multiBranch &&
      !(local.matchedName && local.matchedLocation)
    )
      continue;
    const quotes = playQuotes(page.html);
    if (!quotes.length) continue;
    return {
      id: query.id,
      name: query.name,
      classification: "play-cafe",
      source: "official",
      url: page.url,
      checkedAt,
      identity: { matchedName: true, matchedLocation: true },
      quotes,
      notes: [
        "Official venue content describes a dedicated child-play experience with play-session booking. Confirm admission and session rules; age limits have not been inferred.",
      ],
    };
  }
  return null;
}

export function assessOfficialVenue(
  html: string,
  url: string,
  place: OfficialVenueQuery | Place,
  checkedAt = new Date().toISOString(),
): OfficialVenueEvidence | null {
  return analyseOfficialVenueEvidence(place, [{ html, url }], checkedAt);
}
