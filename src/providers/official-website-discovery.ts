import {
  preparedWebsiteCandidates,
  websiteDiscoveryIdentity,
} from "./prepared-venue-photos";
export { websiteDiscoveryIdentity };
import { isIP } from "node:net";
export type WebsiteDiscoveryQuery = {
  id?: string;
  name: string;
  lat: number;
  lng: number;
  area?: string;
  aliases?: string[];
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
/** Public browsing only reads durable prepared hints; a configured key cannot trigger spend. */
export async function discoverOfficialWebsite(
  query: WebsiteDiscoveryQuery,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<WebsiteDiscoveryResult> {
  if (options.signal?.aborted) return { urls: [], status: "unavailable" };
  return preparedWebsiteCandidates(query) || { urls: [], status: "disabled" };
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
