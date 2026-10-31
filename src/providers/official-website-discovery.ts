import {
  preparedWebsiteCandidates,
  websiteDiscoveryIdentity,
} from "./prepared-venue-photos";
export { websiteDiscoveryIdentity };
import { isIP } from "node:net";
import { distanceKm } from "./routing";
export type WebsiteDiscoveryQuery = {
  id?: string;
  name: string;
  lat: number;
  lng: number;
  area?: string;
  aliases?: string[];
  wikidata?: string;
};
export type WebsiteDiscoveryResult = {
  urls: string[];
  status: "disabled" | "found" | "unavailable" | "no-match";
};
const cache = new Map<
  string,
  { until: number; result: WebsiteDiscoveryResult }
>();
const pending = new Map<string, Promise<WebsiteDiscoveryResult>>();
let active = 0;
const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[&+]/g, "and")
    .replace(/[^\p{L}\p{N}]/gu, "");
const directories =
  /(?:^|\.)(?:facebook\.com|instagram\.com|tiktok\.com|tripadvisor\.[a-z.]+|yelp\.[a-z.]+|google\.[a-z.]+|openstreetmap\.org|dayoutwiththekids\.co\.uk|netmums\.com|wikipedia\.org|yell\.com)$/i;
function candidate(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !url.hostname.includes(".") ||
      isIP(url.hostname.replace(/[\[\]]/g, "")) ||
      /(?:^|\.)(?:localhost|local|internal|home|lan|onion)$/.test(
        url.hostname,
      ) ||
      directories.test(url.hostname)
    )
      return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}
/** Prepared hints, an explicitly mapped public entity, then optional free search. */
export async function discoverOfficialWebsite(
  query: WebsiteDiscoveryQuery,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<WebsiteDiscoveryResult> {
  if (options.signal?.aborted) return { urls: [], status: "unavailable" };
  const prepared = preparedWebsiteCandidates(query);
  if (prepared) return prepared;
  if (!/^Q[1-9]\d{0,14}$/.test(query.wikidata ?? ""))
    return searchFreeWebsite(query, options);
  const started = Date.now();
  const budget = Number.isFinite(options.timeoutMs)
    ? Math.max(0, options.timeoutMs!)
    : 2000;
  if (!budget) return { urls: [], status: "unavailable" };
  const mapped = await mappedWebsite(query, {
    ...options,
    timeoutMs: Math.min(2000, budget),
  });
  if (mapped.status === "found") return mapped;
  if (options.signal?.aborted) return { urls: [], status: "unavailable" };
  const remaining = budget - (Date.now() - started);
  if (!process.env.TINYFISH_API_KEY?.trim() || remaining <= 0) return mapped;
  return searchFreeWebsite(query, { ...options, timeoutMs: remaining });
}

type MappedRequest = {
  task: Promise<WebsiteDiscoveryResult>;
  controller: AbortController;
  consumers: number;
};
const mappedCache = new Map<
  string,
  { until: number; result: WebsiteDiscoveryResult }
>();
const mappedPending = new Map<string, MappedRequest>();
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const nameTokens = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[&+]/g, " and ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .sort()
    .join(" ");

/** Settle locally on abort too: the time bound does not depend on a compliant transport. */
function abortable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(Error("mapped-website-aborted"));
    if (signal.aborted) {
      aborted();
      return;
    }
    signal.addEventListener("abort", aborted, { once: true });
    task
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", aborted));
  });
}
function statementValues(claims: unknown, property: string): unknown[] {
  const rows = object(claims)?.[property];
  return (Array.isArray(rows) ? rows.slice(0, 64) : []).flatMap((row) => {
    const statement = object(row),
      snak = object(statement?.mainsnak);
    return statement?.rank !== "deprecated" && snak?.snaktype === "value"
      ? [object(snak.datavalue)?.value]
      : [];
  });
}
function mappedCandidates(
  data: unknown,
  query: WebsiteDiscoveryQuery,
): string[] {
  const entity = object(object(object(data)?.entities)?.[query.wikidata!]);
  if (!entity || entity.id !== query.wikidata || entity.missing !== undefined)
    return [];
  const labels = object(entity.labels),
    aliases = object(entity.aliases);
  const entityNames = ["en", "en-gb"]
    .flatMap((language) => {
      const languageAliases = aliases?.[language];
      return [
        object(labels?.[language])?.value,
        ...(Array.isArray(languageAliases)
          ? languageAliases
              .slice(0, 64)
              .map((alias: unknown) => object(alias)?.value)
          : []),
      ];
    })
    .filter(
      (name): name is string => typeof name === "string" && name.length <= 200,
    );
  const names = [query.name, ...(query.aliases ?? []).slice(0, 12)]
    .filter((name) => name.length <= 200)
    .map(nameTokens)
    .filter(Boolean);
  if (!entityNames.some((name) => names.includes(nameTokens(name)))) return [];
  const coordinates = statementValues(entity.claims, "P625");
  if (
    !coordinates.some((value) => {
      const c = object(value);
      return (
        c?.globe === "http://www.wikidata.org/entity/Q2" &&
        typeof c.latitude === "number" &&
        Number.isFinite(c.latitude) &&
        Math.abs(c.latitude) <= 90 &&
        typeof c.longitude === "number" &&
        Number.isFinite(c.longitude) &&
        Math.abs(c.longitude) <= 180 &&
        distanceKm(query, { lat: c.latitude, lng: c.longitude }) <= 0.25
      );
    })
  )
    return [];
  return [
    ...new Set(
      statementValues(entity.claims, "P856").flatMap((value) => {
        const url = candidate(value);
        return url ? [url.href] : [];
      }),
    ),
  ].slice(0, 3);
}
async function mappedWebsite(
  query: WebsiteDiscoveryQuery,
  options: { signal?: AbortSignal; timeoutMs: number },
): Promise<WebsiteDiscoveryResult> {
  if (
    !query.name.trim() ||
    query.name.length > 200 ||
    !Number.isFinite(query.lat) ||
    Math.abs(query.lat) > 90 ||
    !Number.isFinite(query.lng) ||
    Math.abs(query.lng) > 180
  )
    return { urls: [], status: "no-match" };
  const key = JSON.stringify([
    query.wikidata,
    query.id?.slice(0, 200),
    nameTokens(query.name),
    query.lat,
    query.lng,
    (query.aliases ?? [])
      .slice(0, 12)
      .filter((name) => name.length <= 200)
      .map(nameTokens),
  ]);
  const cached = mappedCache.get(key);
  if (cached && cached.until > Date.now()) return cached.result;
  let request = mappedPending.get(key);
  if (!request) {
    if (mappedPending.size >= 4) return { urls: [], status: "unavailable" };
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(Math.max(1, Math.floor(options.timeoutMs))),
    ]);
    const task = (async (): Promise<WebsiteDiscoveryResult> => {
      try {
        const url = new URL("https://www.wikidata.org/w/api.php");
        url.search = new URLSearchParams({
          action: "wbgetentities",
          ids: query.wikidata!,
          props: "labels|aliases|claims",
          languages: "en|en-gb",
          format: "json",
          formatversion: "2",
        }).toString();
        const response = await abortable(
          fetch(url.href, {
            headers: {
              "User-Agent":
                "SideQuest/1.0 (venue website metadata; https://sidequest-local-discovery.vercel.app)",
              Accept: "application/json",
            },
            cache: "no-store",
            redirect: "error",
            signal,
          }),
          signal,
        );
        if (
          !response.ok ||
          Number(response.headers.get("content-length")) > 524288
        ) {
          void response.body?.cancel().catch(() => {});
          throw Error("mapped-website-response");
        }
        const reader = response.body?.getReader();
        if (!reader) throw Error("mapped-website-response");
        let bytes = 0,
          body = "";
        const decoder = new TextDecoder();
        try {
          while (true) {
            const part = await abortable(reader.read(), signal);
            if (part.done) break;
            bytes += part.value.byteLength;
            if (bytes > 524288) throw Error("mapped-website-size");
            body += decoder.decode(part.value, { stream: true });
          }
          body += decoder.decode();
        } finally {
          void reader.cancel().catch(() => {});
        }
        signal.throwIfAborted();
        const urls = mappedCandidates(JSON.parse(body), query);
        return { urls, status: urls.length ? "found" : "no-match" };
      } catch {
        return { urls: [], status: "unavailable" };
      }
    })()
      .then((result) => {
        if (!controller.signal.aborted) {
          mappedCache.set(key, {
            result,
            until:
              Date.now() +
              (result.status === "found"
                ? 7 * 86400000
                : result.status === "no-match"
                  ? 3600000
                  : 60000),
          });
          if (mappedCache.size > 512)
            mappedCache.delete(mappedCache.keys().next().value!);
        }
        return result;
      })
      .finally(() => mappedPending.delete(key));
    request = { task, controller, consumers: 0 };
    mappedPending.set(key, request);
  }
  request.consumers++;
  const callerSignal = AbortSignal.any([
    AbortSignal.timeout(Math.max(1, Math.floor(options.timeoutMs))),
    ...(options.signal ? [options.signal] : []),
  ]);
  try {
    return await abortable(request.task, callerSignal);
  } catch {
    return { urls: [], status: "unavailable" };
  } finally {
    request.consumers--;
    if (!request.consumers) request.controller.abort();
  }
}

const freeCache = new Map<
  string,
  { until: number; result: WebsiteDiscoveryResult }
>();
const freePending = new Map<string, Promise<WebsiteDiscoveryResult>>();
let freeCooldown = 0;
const freeRequests: number[] = [];
async function searchFreeWebsite(
  query: WebsiteDiscoveryQuery,
  options: { signal?: AbortSignal; timeoutMs?: number },
): Promise<WebsiteDiscoveryResult> {
  const apiKey = process.env.TINYFISH_API_KEY?.trim();
  if (!apiKey) return { urls: [], status: "disabled" };
  if (
    !query.name.trim() ||
    query.name.length > 200 ||
    !Number.isFinite(query.lat) ||
    !Number.isFinite(query.lng)
  )
    return { urls: [], status: "no-match" };
  const key = websiteDiscoveryIdentity(query);
  const cached = freeCache.get(key);
  if (cached && cached.until > Date.now()) return cached.result;
  const pending = freePending.get(key);
  if (pending) return pending;
  const now = Date.now();
  while (freeRequests.length && freeRequests[0] <= now - 3600000)
    freeRequests.shift();
  if (
    options.signal?.aborted ||
    freeCooldown > now ||
    freePending.size >= 3 ||
    freeRequests.length >= 500 ||
    freeRequests.filter((at) => at > now - 60000).length >= 30
  )
    return { urls: [], status: "unavailable" };
  freeRequests.push(now);
  const task = (async (): Promise<WebsiteDiscoveryResult> => {
    try {
      const url = new URL("https://api.search.tinyfish.ai");
      url.search = new URLSearchParams({
        query: `${query.name} ${query.area && query.area !== "Nearby" ? query.area.slice(0, 120) : ""} UK official website`,
        location: "GB",
        language: "en",
      }).toString();
      const response = await fetch(url.href, {
        headers: { "X-API-Key": apiKey },
        cache: "no-store",
        signal: AbortSignal.any([
          AbortSignal.timeout(
            Math.max(1, Math.min(3000, options.timeoutMs ?? 2200)),
          ),
          ...(options.signal ? [options.signal] : []),
        ]),
      });
      if (!response.ok) {
        if ([401, 402, 429, 503].includes(response.status)) {
          const seconds = Number(response.headers.get("retry-after"));
          freeCooldown =
            Date.now() +
            (Number.isFinite(seconds) && seconds > 0
              ? Math.min(seconds, 86400) * 1000
              : response.status === 402
                ? 3600000
                : 60000);
        }
        return { urls: [], status: "unavailable" };
      }
      const reader = response.body?.getReader();
      if (!reader) return { urls: [], status: "unavailable" };
      let bytes = 0,
        body = "";
      const decoder = new TextDecoder();
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 262144) throw Error("search-size");
          body += decoder.decode(part.value, { stream: true });
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const data = JSON.parse(body);
      const names = [query.name, ...(query.aliases ?? []).slice(0, 12)]
        .map(normalize)
        .filter(Boolean);
      const urls: string[] = [],
        hosts = new Set<string>();
      for (const row of Array.isArray(data.results)
        ? data.results.slice(0, 10)
        : []) {
        const site = candidate(row?.url);
        if (!site || hosts.has(site.hostname.replace(/^www\./, ""))) continue;
        const context = normalize(
          `${typeof row.title === "string" ? row.title : ""} ${typeof row.snippet === "string" ? row.snippet.slice(0, 4000) : ""}`,
        );
        if (!names.some((name) => context.includes(name))) continue;
        hosts.add(site.hostname.replace(/^www\./, ""));
        urls.push(site.href);
        if (urls.length === 3) break;
      }
      return { urls, status: urls.length ? "found" : "no-match" };
    } catch {
      return { urls: [], status: "unavailable" };
    }
  })()
    .then((result) => {
      freeCache.set(key, {
        result,
        until:
          Date.now() +
          (result.status === "found"
            ? 7 * 86400000
            : result.status === "no-match"
              ? 3600000
              : 60000),
      });
      if (freeCache.size > 512)
        freeCache.delete(freeCache.keys().next().value!);
      return result;
    })
    .finally(() => freePending.delete(key));
  freePending.set(key, task);
  return task;
}
/** Explicit offline maintenance only. Callers must reserve their persistent search budget first. */
export async function searchOfficialWebsite(
  query: WebsiteDiscoveryQuery,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<WebsiteDiscoveryResult> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) return { urls: [], status: "disabled" };
  if (
    !query.name.trim() ||
    query.name.length > 200 ||
    !Number.isFinite(query.lat) ||
    !Number.isFinite(query.lng)
  )
    return { urls: [], status: "no-match" };
  const key = websiteDiscoveryIdentity(query);
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.result;
  const running = pending.get(key);
  if (running) return running;
  if (active >= 2 || options.signal?.aborted)
    return { urls: [], status: "unavailable" };
  active++;
  const task = (async (): Promise<WebsiteDiscoveryResult> => {
    try {
      const signal = AbortSignal.any([
        AbortSignal.timeout(
          Math.max(1, Math.min(3000, options.timeoutMs ?? 2200)),
        ),
        ...(options.signal ? [options.signal] : []),
      ]);
      const area =
        query.area && query.area !== "Nearby" ? query.area.slice(0, 120) : "";
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        signal,
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: `${query.name} ${area} UK official venue website`,
          search_depth: "basic",
          max_results: 5,
          include_answer: false,
          include_raw_content: false,
          include_images: false,
          auto_parameters: false,
        }),
      });
      if (!response.ok) throw new Error("search-unavailable");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("search-unavailable");
      let size = 0;
      let text = "";
      const decoder = new TextDecoder();
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 262144) throw new Error("search-unavailable");
          text += decoder.decode(part.value, { stream: true });
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const data = JSON.parse(text);
      const names = [query.name, ...(query.aliases ?? []).slice(0, 12)]
        .map(normalize)
        .filter(Boolean);
      const urls: string[] = [];
      const hosts = new Set<string>();
      for (const row of Array.isArray(data.results)
        ? data.results.slice(0, 5)
        : []) {
        const url = candidate(row?.url);
        if (!url || hosts.has(url.hostname.replace(/^www\./, ""))) continue;
        const context = normalize(
          `${typeof row.title === "string" ? row.title : ""} ${typeof row.content === "string" ? row.content.slice(0, 6000) : ""}`,
        );
        if (!names.some((name) => context.includes(name))) continue;
        hosts.add(url.hostname.replace(/^www\./, ""));
        urls.push(url.href);
        if (urls.length >= 3) break;
      }
      return { urls, status: urls.length ? "found" : "no-match" };
    } catch {
      return { urls: [], status: "unavailable" };
    }
  })()
    .then((result) => {
      if (cache.size >= 512) cache.delete(cache.keys().next().value!);
      cache.set(key, {
        result,
        until:
          Date.now() +
          (result.status === "found"
            ? 7 * 86400000
            : result.status === "no-match"
              ? 3600000
              : 60000),
      });
      return result;
    })
    .finally(() => {
      active--;
      pending.delete(key);
    });
  pending.set(key, task);
  return task;
}
