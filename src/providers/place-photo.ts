/** Keyless, conservative Wikimedia photo resolution. Never substitutes nearby stock imagery. */
export interface PhotoQuery {
  name: string;
  lat: number;
  lng: number;
  wikidata?: string;
  wikipedia?: string;
}
export interface PlacePhoto {
  url: string;
  credit: string;
  license: string;
  source: string;
}
export interface PhotoResult {
  image: PlacePhoto | null;
  source: "live" | "cached" | "unavailable";
}
type Page = {
  index?: number;
  title?: string;
  pageimage?: string;
  coordinates?: { lat: number; lon: number }[];
  imageinfo?: ImageInfo[];
};
type ImageInfo = {
  url?: string;
  thumburl?: string;
  descriptionurl?: string;
  width?: number;
  height?: number;
  mime?: string;
  extmetadata?: Record<string, { value?: string }>;
};
const cache = new Map<string, { expires: number; image: PlacePhoto | null }>();
const pending = new Map<string, Promise<PhotoResult>>();
let active = 0;
export function parsePhotoQuery(params: URLSearchParams): PhotoQuery | null {
  const name = params.get("name")?.trim();
  const rawLat = params.get("lat");
  const rawLng = params.get("lng");
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  const wikidata = params.get("wikidata") || undefined;
  const wikipedia = params.get("wikipedia") || undefined;
  if (
    !name ||
    name.length > 160 ||
    /[\x00-\x1f]/.test(name) ||
    !rawLat?.trim() ||
    !rawLng?.trim() ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180 ||
    (wikidata && !/^Q[1-9]\d{0,11}$/.test(wikidata)) ||
    (wikipedia &&
      (!/^[a-z]{2,12}:[^\x00-\x1f]{1,180}$/.test(wikipedia) ||
        /^[a-z]+:\/\//i.test(wikipedia)))
  )
    return null;
  return { name, lat, lng, wikidata, wikipedia };
}
export function plainCredit(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(
      /&(?:amp|quot|apos|lt|gt|nbsp);/g,
      (entity) =>
        ({
          "&amp;": "&",
          "&quot;": '"',
          "&apos;": "'",
          "&lt;": "<",
          "&gt;": ">",
          "&nbsp;": " ",
        })[entity] || "",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}
export function safePhotoUrl(
  value: string | undefined,
  description = false,
): boolean {
  if (!value) return false;
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      (description
        ? u.hostname === "commons.wikimedia.org" &&
          u.pathname.startsWith("/wiki/File:")
        : u.hostname === "upload.wikimedia.org" &&
          u.pathname.startsWith("/wikipedia/commons/"))
    );
  } catch {
    return false;
  }
}
function normalize(s: string) {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
const genericNameWords = new Set([
  "park",
  "grounds",
  "garden",
  "gardens",
  "museum",
  "castle",
  "the",
  "great",
  "royal",
  "botanical",
  "central",
  "public",
]);
/** Keep distinctive names intact; never reduce Central Park to the generic Central. */
export function canonicalPlaceName(name: string): string {
  const words = normalize(name).replace(/^the /, "").split(" ");
  const shortened = words.slice(0, -1);
  if (
    ["grounds", "park"].includes(words.at(-1) || "") &&
    shortened.length >= 2 &&
    shortened.some((word) => !genericNameWords.has(word))
  )
    return shortened.join(" ");
  return words.join(" ");
}
export function matchesPlaceName(name: string, candidate: string): boolean {
  const n = canonicalPlaceName(name);
  const c = normalize(candidate.replace(/^File:/, ""));
  return n.length >= 3 && ` ${c} `.includes(` ${n} `);
}
function matchingRadius(query: PhotoQuery): number {
  const words = canonicalPlaceName(query.name).split(" ");
  // Named multiword subjects can span a garden/grounds; generic subjects stay tight.
  return words.length >= 2 && words.some((word) => !genericNameWords.has(word))
    ? 600
    : 400;
}
export function isNearPlace(
  query: PhotoQuery,
  lat: number,
  lng: number,
  radius = 400,
): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const radians = Math.PI / 180;
  const a =
    Math.sin(((lat - query.lat) * radians) / 2) ** 2 +
    Math.cos(query.lat * radians) *
      Math.cos(lat * radians) *
      Math.sin(((lng - query.lng) * radians) / 2) ** 2;
  return (
    6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - Math.min(a, 1))) <=
    radius
  );
}
export function licensedPhoto(info: ImageInfo): PlacePhoto | null {
  const meta = info.extmetadata || {};
  const license = plainCredit(meta.LicenseShortName?.value || "");
  const credit = plainCredit(meta.Artist?.value || "");
  const url = safePhotoUrl(info.thumburl) ? info.thumburl! : info.url;
  if (
    !safePhotoUrl(url) ||
    !safePhotoUrl(info.descriptionurl, true) ||
    !credit ||
    !/^(?:CC(?:0| BY(?:-SA)?)(?: [0-9.]+)?|Public domain)$/i.test(license) ||
    !["image/jpeg", "image/png", "image/webp"].includes(info.mime || "") ||
    (info.width || 0) < 600 ||
    (info.height || 0) < 300 ||
    (info.width || 0) <= (info.height || 0)
  )
    return null;
  return { url: url!, credit, license, source: info.descriptionurl! };
}
async function api(
  host: string,
  params: Record<string, string>,
  signal: AbortSignal,
) {
  // host is only supplied by internal constants or a validated language subdomain.
  const url = new URL(`https://${host}/w/api.php`);
  url.search = new URLSearchParams({
    format: "json",
    formatversion: "2",
    ...params,
  }).toString();
  const response = await fetch(url, {
    signal,
    redirect: "error",
    headers: {
      "User-Agent":
        "SideQuest/1.0 (local discovery; Wikimedia photo attribution)",
    },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Wikimedia unavailable");
  const body = await response.text();
  if (body.length > 1_500_000) throw new Error("Response too large");
  return JSON.parse(body);
}
async function commonsPhoto(
  file: string,
  signal: AbortSignal,
): Promise<PlacePhoto | null> {
  const data = await api(
    "commons.wikimedia.org",
    {
      action: "query",
      titles: `File:${file.replace(/^File:/, "")}`,
      prop: "imageinfo",
      iiprop: "url|size|mime|extmetadata",
      iiurlwidth: "1280",
    },
    signal,
  );
  return licensedPhoto(data.query?.pages?.[0]?.imageinfo?.[0] || {});
}
async function resolve(query: PhotoQuery): Promise<PlacePhoto | null> {
  const signal = AbortSignal.timeout(6500);
  if (query.wikidata) {
    const data = await api(
      "www.wikidata.org",
      {
        action: "wbgetentities",
        ids: query.wikidata,
        props: "labels|aliases|claims",
        languages: "en",
      },
      signal,
    );
    const entity = data.entities?.[query.wikidata];
    const names = [
      entity?.labels?.en?.value,
      ...(entity?.aliases?.en || []).map(
        (alias: { value: string }) => alias.value,
      ),
    ].filter(Boolean);
    const coordinate = entity?.claims?.P625?.find(
      (claim: {
        rank?: string;
        mainsnak?: { datavalue?: { value?: { globe?: string } } };
      }) =>
        claim.rank !== "deprecated" &&
        claim.mainsnak?.datavalue?.value?.globe ===
          "http://www.wikidata.org/entity/Q2",
    )?.mainsnak?.datavalue?.value;
    if (
      coordinate &&
      isNearPlace(
        query,
        coordinate.latitude,
        coordinate.longitude,
        matchingRadius(query),
      ) &&
      names.some((name: string) => matchesPlaceName(query.name, name))
    ) {
      const file = entity?.claims?.P18?.find(
        (claim: { rank?: string }) => claim.rank !== "deprecated",
      )?.mainsnak?.datavalue?.value;
      if (typeof file === "string") {
        const photo = await commonsPhoto(file, signal);
        if (photo) return photo;
      }
    }
  }
  if (query.wikipedia) {
    const [language, ...title] = query.wikipedia.split(":");
    const data = await api(
      `${language}.wikipedia.org`,
      {
        action: "query",
        titles: title.join(":"),
        prop: "coordinates|pageimages",
        piprop: "name",
        redirects: "1",
      },
      signal,
    );
    const page: Page | undefined = data.query?.pages?.[0];
    const point = page?.coordinates?.[0];
    if (
      page?.pageimage &&
      page.title &&
      matchesPlaceName(query.name, page.title) &&
      point &&
      isNearPlace(query, point.lat, point.lon, matchingRadius(query))
    ) {
      const photo = await commonsPhoto(page.pageimage, signal);
      if (photo) return photo;
    }
  }
  // Filename AND subject coordinates must match: a nearby file alone is never sufficient.
  const data = await api(
    "commons.wikimedia.org",
    {
      action: "query",
      generator: "search",
      gsrsearch: `"${canonicalPlaceName(query.name).replace(/["\\]/g, "")}"`,
      gsrnamespace: "6",
      gsrlimit: "8",
      // GeoData coordinates use lat/lon (not imageinfo GPS fields).
      prop: "coordinates|imageinfo",
      colimit: "max",
      coprimary: "all",
      iiprop: "url|size|mime|extmetadata",
      iiurlwidth: "1280",
    },
    signal,
  );
  const candidates = ((data.query?.pages || []) as Page[])
    .sort(
      (a, b) =>
        (a.index ?? 999) - (b.index ?? 999) ||
        (b.imageinfo?.[0]?.width ?? 0) - (a.imageinfo?.[0]?.width ?? 0),
    )
    .filter(
      (page) =>
        page.title &&
        matchesPlaceName(query.name, page.title) &&
        page.coordinates?.some((point) =>
          isNearPlace(query, point.lat, point.lon, matchingRadius(query)),
        ),
    )
    .map((page) => licensedPhoto(page.imageinfo?.[0] || {}))
    .filter((photo): photo is PlacePhoto => !!photo);
  return candidates[0] || null;
}
export async function lookupPlacePhoto(
  query: PhotoQuery,
): Promise<PhotoResult> {
  const key = JSON.stringify([
    normalize(query.name),
    query.lat.toFixed(4),
    query.lng.toFixed(4),
    query.wikidata,
    query.wikipedia,
  ]);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now())
    return { image: hit.image, source: "cached" };
  if (pending.has(key)) return pending.get(key)!;
  // Bound upstream concurrency and avoid an unbounded waiting queue during viewport bursts.
  if (active >= 6) return { image: null, source: "unavailable" };
  active++;
  const promise = (async (): Promise<PhotoResult> => {
    let image: PlacePhoto | null = null;
    try {
      image = await resolve(query);
    } catch {
      /* Fail closed on outages, timeout or unverifiable images. */
    }
    if (cache.size >= 1000) cache.delete(cache.keys().next().value!);
    cache.set(key, {
      image,
      expires: Date.now() + (image ? 24 * 60 * 60_000 : 5 * 60_000),
    });
    return { image, source: image ? "live" : "unavailable" };
  })().finally(() => {
    active--;
    pending.delete(key);
  });
  pending.set(key, promise);
  return promise;
}
