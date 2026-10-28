import type { Place } from "@/domain/models";
import {
  safeOfficialPhotoUrl,
  type OfficialPhotoOptions,
} from "./official-photo";
import {
  analyseOfficialVenueEvidence,
  type OfficialVenueEvidence,
  type OfficialVenuePage,
} from "./official-venue-evidence";
import { effectiveCompany, venueSuitability } from "@/domain/venue-suitability";
export type VenueEnrichmentResult = {
  status: "verified" | "unknown" | "unavailable" | "disabled";
  place: Place | null;
};
type Dependencies = {
  getPlace: (id: string) => Promise<Place | null>;
  discoverWebsite: (
    query: {
      id: string;
      name: string;
      lat: number;
      lng: number;
      area?: string;
      aliases?: string[];
    },
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ) => Promise<{ urls: string[]; status: string }>;
  readWebsite: (
    url: string,
    options?: OfficialPhotoOptions,
  ) => Promise<{ html: string; pageUrl: string; requestCount: number }>;
  timeoutMs?: number;
};
export function applyOfficialVenueEvidence(
  place: Place,
  record: OfficialVenueEvidence,
): Place {
  const age = Date.now() - Date.parse(record.checkedAt);
  if (
    record.id !== place.id ||
    record.name !== place.name ||
    record.source !== "official" ||
    record.classification !== "play-cafe" ||
    !record.identity.matchedName ||
    !record.identity.matchedLocation ||
    !record.quotes.length ||
    !safeOfficialPhotoUrl(record.url) ||
    !(age >= 0 && age < 90 * 86400000)
  )
    return place;
  const evidence = {
    source: "official" as const,
    confidence: "verified" as const,
    url: record.url,
    checkedAt: record.checkedAt,
  };
  const updated: Place = {
    ...place,
    category: "Play café",
    optionalCategory: undefined,
    environment: "indoor",
    website: record.url,
    intents: [
      ...new Set([...place.intents, "kids" as const, "active" as const]),
    ],
    experiences: [
      ...(place.experiences ?? []).filter((item) => !item.primary),
      { activities: ["soft-play"], primary: true, evidence },
    ],
    evidence: { ...place.evidence, classification: evidence },
    notes: [
      ...new Set([
        ...place.notes,
        ...record.notes,
        `Classification source checked ${record.checkedAt}: ${record.url}.`,
      ]),
    ],
  };
  updated.suitability = { ...venueSuitability(updated), source: "official" };
  updated.company = effectiveCompany(updated);
  return updated;
}
function linkedPages(page: OfficialVenuePage): string[] {
  const urls = new Set<string>();
  for (const match of page.html.matchAll(
    /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    if (
      !/\b(?:play|sessions?|book(?:ing)?|about|contact|visit)\b/i.test(
        `${match[1]} ${match[2]}`.replace(/[-_]/g, " "),
      )
    )
      continue;
    try {
      const url = new URL(match[1].replace(/&amp;/g, "&"), page.url);
      url.hash = "";
      if (
        url.origin === new URL(page.url).origin &&
        safeOfficialPhotoUrl(url.href) &&
        !/\.(?:pdf|jpg|jpeg|png|gif|webp|svg)$/i.test(url.pathname) &&
        url.href !== page.url
      )
        urls.add(url.href);
    } catch {
      /* Ignore malformed page links. */
    }
  }
  return [...urls].slice(0, 3);
}

function officialCandidate(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol === "http:") url.protocol = "https:";
    if (
      !safeOfficialPhotoUrl(url.href) ||
      /(?:^|\.)(?:openstreetmap\.org|wikidata\.org|wikipedia\.org|facebook\.com|instagram\.com|tiktok\.com|tripadvisor\.[a-z.]+|yelp\.[a-z.]+|google\.[a-z.]+|yell\.com|dayoutwiththekids\.co\.uk|netmums\.com)$/.test(
        url.hostname,
      )
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Server-side, cached by a trusted OSM identity. Browser requests cannot supply arbitrary website URLs. */
export function createVenueEnricher(deps: Dependencies) {
  const cache = new Map<string, { at: number; value: VenueEnrichmentResult }>();
  const pending = new Map<string, Promise<VenueEnrichmentResult>>();
  let active = 0;
  return async (id: string): Promise<VenueEnrichmentResult> => {
    if (!/^osm-(?:node|way|relation)-[1-9]\d{0,15}$/.test(id))
      return { status: "unknown", place: null };
    const known = cache.get(id);
    const ttl =
      known?.value.status === "verified"
        ? 86400000
        : ["unavailable", "disabled"].includes(known?.value.status ?? "")
          ? 60000
          : 6 * 3600000;
    if (known && Date.now() - known.at < ttl) return known.value;
    if (pending.has(id)) return pending.get(id)!;
    if (active >= 2) return { status: "unavailable", place: null };
    active++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 14000);
    const signal = controller.signal;
    const bounded = <T>(task: Promise<T>): Promise<T> =>
      new Promise((resolve, reject) => {
        const aborted = () =>
          reject(new Error("Venue metadata deadline exceeded"));
        if (signal.aborted) return aborted();
        signal.addEventListener("abort", aborted, { once: true });
        task
          .then(resolve, reject)
          .finally(() => signal.removeEventListener("abort", aborted));
      });
    const work = (async (): Promise<VenueEnrichmentResult> => {
      let failed = false;
      try {
        const place = await bounded(deps.getPlace(id));
        if (
          !place ||
          place.id !== id ||
          !/\bcaf[eé](?:\b|$)|\bcoffee\b/i.test(place.category)
        )
          return { status: "unknown", place: null };
        const ownUrl = officialCandidate(place.website);
        let candidates = ownUrl ? [ownUrl] : [];
        if (!ownUrl) {
          const discovered = await bounded(
            deps.discoverWebsite(
              {
                id,
                name: place.name,
                lat: place.coordinates.lat,
                lng: place.coordinates.lng,
                area: place.area,
                aliases: place.aliases,
              },
              { signal, timeoutMs: 5000 },
            ),
          );
          if (
            discovered.status === "unavailable" ||
            discovered.status === "disabled"
          )
            return { status: discovered.status, place: null };
          candidates = discovered.urls
            .map(officialCandidate)
            .filter((url): url is string => !!url)
            .slice(0, 2);
        }
        for (const url of candidates) {
          if (signal.aborted) break;
          const pages: OfficialVenuePage[] = [];
          try {
            const first = await bounded(
              deps.readWebsite(url, { signal, timeoutMs: 4500 }),
            );
            if (!officialCandidate(first.pageUrl)) continue;
            pages.push({ html: first.html, url: first.pageUrl });
            let record = analyseOfficialVenueEvidence(
              place,
              pages,
              new Date().toISOString(),
            );
            for (const linked of record ? [] : linkedPages(pages[0])) {
              try {
                const next = await bounded(
                  deps.readWebsite(linked, { signal, timeoutMs: 2500 }),
                );
                if (
                  new URL(next.pageUrl).origin !== new URL(first.pageUrl).origin
                )
                  continue;
                pages.push({ html: next.html, url: next.pageUrl });
                record = analyseOfficialVenueEvidence(
                  place,
                  pages,
                  new Date().toISOString(),
                );
                if (record) break;
              } catch {
                failed = true;
              }
            }
            if (record)
              return {
                status: "verified",
                place: applyOfficialVenueEvidence(place, record),
              };
          } catch {
            failed = true;
          }
        }
        return {
          status: failed || signal.aborted ? "unavailable" : "unknown",
          place: null,
        };
      } catch {
        return { status: "unavailable", place: null };
      }
    })()
      .then((value) => {
        cache.set(id, { at: Date.now(), value });
        if (cache.size > 1000) cache.delete(cache.keys().next().value!);
        return value;
      })
      .finally(() => {
        clearTimeout(timer);
        active--;
        pending.delete(id);
      });
    pending.set(id, work);
    return work;
  };
}
