/** Keyless, conservative Wikimedia photo resolution. Never substitutes nearby stock imagery. */
export interface PhotoQuery {
  name: string;
  lat: number;
  lng: number;
  wikidata?: string;
  wikipedia?: string;
  id?: string;
  area?: string;
  category?: string;
  aliases?: string[];
  osmImage?: string;
  commons?: string;
  website?: string;
}
export interface PlacePhoto {
  url: string;
  credit: string;
  license: string;
  source: string;
  width?: number;
  height?: number;
  confidence?: number;
  strategy?: string;
  matched?: string[];
}
export interface PhotoDiagnostics {
  strategy: string | null;
  sourcesAttempted: string[];
  candidateCount: number;
  rejected: Record<string, number>;
  requestCount: number;
  elapsedMs: number;
  cacheHit?: boolean;
}
export interface PhotoResult {
  image: PlacePhoto | null;
  source: "live" | "cached" | "unavailable";
  diagnostics?: PhotoDiagnostics;
  retryable?: boolean;
}
type Page = {
  pageid?: number;
  categories?: { title: string }[];
  caption?: string;
  depicts?: string[];
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
const cache = new Map<string, { expires: number; result: PhotoResult }>();
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
  const optional: Partial<PhotoQuery> = {};
  for (const key of [
    "id",
    "area",
    "category",
    "osmImage",
    "commons",
    "website",
  ] as const) {
    const value = params.get(key)?.trim();
    if (value && (value.length > 500 || /[\x00-\x1f]/.test(value))) return null;
    if (value) optional[key] = value;
  }
  const aliasValues = params.getAll("aliases");
  try {
    const aliases: unknown =
      aliasValues.length === 1 && aliasValues[0].startsWith("[")
        ? JSON.parse(aliasValues[0])
        : aliasValues.flatMap((value) => value.split("|"));
    if (
      !Array.isArray(aliases) ||
      aliases.length > 12 ||
      aliases.some(
        (alias) =>
          typeof alias !== "string" ||
          alias.length > 160 ||
          /[\x00-\x1f]/.test(alias),
      )
    )
      return null;
    if (aliases.length)
      optional.aliases = aliases
        .map((alias: string) => alias.trim())
        .filter(Boolean);
  } catch {
    return null;
  }
  return { name, lat, lng, wikidata, wikipedia, ...optional };
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
    Math.min(info.width || 0, info.height || 0) < 400 ||
    Math.max(info.width || 0, info.height || 0) < 600
  )
    return null;
  // Commons may append campaign parameters; image identity is entirely in its path.
  const imageUrl = new URL(url!);
  imageUrl.search = "";
  imageUrl.hash = "";
  return {
    url: imageUrl.href,
    credit,
    license,
    source: info.descriptionurl!,
    width: info.width,
    height: info.height,
  };
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
  const data = JSON.parse(body);
  if (data.error) throw new Error("Wikimedia API error");
  return data;
}

type Claim = { rank?: string; mainsnak?: { datavalue?: { value?: unknown } } };
type Entity = {
  labels?: Record<string, { value: string }>;
  aliases?: Record<string, { value: string }[]>;
  claims?: Record<string, Claim[]>;
  statements?: Record<string, Claim[]>;
  sitelinks?: Record<string, { title: string }>;
};
type Candidate = {
  page: Page;
  strategy: string;
  declared?: boolean;
  entityCategory?: boolean;
  verifiedCategory?: boolean;
  evidence?: string[];
};
const mediaParams = {
  prop: "coordinates|imageinfo|categories",
  colimit: "max",
  coprimary: "all",
  cllimit: "40",
  iiprop: "url|size|mime|extmetadata",
  iiurlwidth: "1600",
  iiextmetadatalanguage: "en",
};
function claimValues(entity: Entity | undefined, property: string): unknown[] {
  return (entity?.claims?.[property] || entity?.statements?.[property] || [])
    .filter((claim) => claim.rank !== "deprecated")
    .sort(
      (a, b) => Number(b.rank === "preferred") - Number(a.rank === "preferred"),
    )
    .map((claim) => claim.mainsnak?.datavalue?.value);
}
/** Only Commons file/category references are dereferenced; external OSM image URLs have no verified license. */
function commonsReference(value: string | undefined): string | null {
  if (!value || value.length > 500) return null;
  let reference = value.trim();
  if (/^https?:\/\//i.test(reference)) {
    try {
      const url = new URL(reference);
      if (url.protocol !== "https:" || url.username || url.password || url.port)
        return null;
      if (
        url.hostname === "commons.wikimedia.org" &&
        url.pathname.startsWith("/wiki/")
      ) {
        reference = decodeURIComponent(url.pathname.slice(6)).replace(
          /^Special:FilePath\//i,
          "File:",
        );
      } else if (safePhotoUrl(reference)) {
        reference =
          "File:" +
          decodeURIComponent(url.pathname.split("/").at(-1) || "").replace(
            /^\d+px-/,
            "",
          );
      } else return null;
    } catch {
      return null;
    }
  }
  reference = reference.replace(/_/g, " ");
  return /^(File|Category):[^\x00-\x1f|<>]{1,300}$/i.test(reference)
    ? reference
    : null;
}
function subjectText(page: Page): string {
  const meta = page.imageinfo?.[0]?.extmetadata || {};
  return [
    page.title?.replace(/^File:/, ""),
    page.caption,
    meta.ImageDescription?.value,
    meta.ObjectName?.value,
    meta.Categories?.value,
    ...(page.categories || []).map((category) =>
      category.title.replace(/^Category:/, ""),
    ),
  ]
    .filter(Boolean)
    .map((value) => plainCredit(value!))
    .join(" ");
}
function nonPhotographic(page: Page): boolean {
  const text = normalize(
    [page.title, page.imageinfo?.[0]?.extmetadata?.ObjectName?.value].join(" "),
  );
  return /\b(?:logo|logos|icon|icons|diagram|diagrams|map|maps|floor plan|site plan|coat of arms|flag|flags|drawing|drawings|engraving|illustration|poster)\b/.test(
    text,
  );
}
function incidentalPlaceReference(query: PhotoQuery, page: Page): boolean {
  const title = normalize((page.title || "").replace(/^File:/, ""));
  const description = normalize(
    [page.caption, page.imageinfo?.[0]?.extmetadata?.ImageDescription?.value]
      .filter(Boolean)
      .map((value) => plainCredit(value!))
      .join(" "),
  );
  return [query.name, ...(query.aliases || [])].some((name) => {
    const normalized = canonicalPlaceName(name);
    if (title.startsWith(normalized + " ")) return false;
    return [
      "opposite",
      "across from",
      "next to",
      "near",
      "beside",
      "view from",
      "seen from",
    ].some(
      (relation) =>
        ` ${title} `.includes(` ${relation} ${normalized} `) ||
        ` ${description} `.includes(` ${relation} ${normalized} `),
    );
  });
}
function areaMatch(area: string | undefined, text: string): boolean {
  if (!area) return false;
  const candidate = ` ${normalize(text)} `;
  return area.split(/[,/|]/).some((part) => {
    const normalized = normalize(part).replace(
      /^(?:county of|city of|town of) /,
      "",
    );
    return normalized.length >= 3 && candidate.includes(` ${normalized} `);
  });
}
function nameEvidence(query: PhotoQuery, text: string): string | undefined {
  if (matchesPlaceName(query.name, text)) return "subject-name";
  return query.aliases?.some((name) => matchesPlaceName(name, text))
    ? "alias"
    : undefined;
}
function photoQuality(photo: PlacePhoto): number {
  const width = photo.width || 0,
    height = photo.height || 0;
  const ratio = width / height;
  // Resolution and usable card crop rank photos; portrait is a fallback, never a blanket exclusion.
  const resolution = Math.min(1, Math.max(width, height) / 2400) * 0.12;
  const landscape =
    ratio >= 1.15 && ratio <= 2.3 ? 0.09 : ratio >= 0.9 ? 0.04 : 0;
  return resolution + landscape;
}

async function resolve(query: PhotoQuery): Promise<PhotoResult> {
  const started = Date.now();
  const signal = AbortSignal.timeout(10_000);
  const diagnostics: PhotoDiagnostics = {
    strategy: null,
    sourcesAttempted: [],
    candidateCount: 0,
    rejected: {},
    requestCount: 0,
    elapsedMs: 0,
  };
  let hadError = false;
  const rejected = (reason: string) => {
    diagnostics.rejected[reason] = (diagnostics.rejected[reason] || 0) + 1;
  };
  const attempted = (strategy: string) => {
    if (!diagnostics.sourcesAttempted.includes(strategy))
      diagnostics.sourcesAttempted.push(strategy);
  };
  const request = async (
    host: string,
    params: Record<string, string>,
    strategy: string,
  ) => {
    attempted(strategy);
    if (signal.aborted || diagnostics.requestCount >= 14) {
      hadError = true;
      return null;
    }
    diagnostics.requestCount++;
    try {
      return await api(host, params, signal);
    } catch {
      hadError = true;
      rejected("upstream-error");
      return null;
    }
  };
  const visited = new Set<string>();
  const evaluate = (candidates: Candidate[]): PlacePhoto | null => {
    const photos: { photo: PlacePhoto; score: number }[] = [];
    for (const candidate of candidates) {
      const { page } = candidate;
      const key = `${page.title || page.pageid}|${candidate.strategy}`;
      if (visited.has(key)) continue;
      visited.add(key);
      diagnostics.candidateCount++;
      if (nonPhotographic(page)) {
        rejected("non-photographic");
        continue;
      }
      if (incidentalPlaceReference(query, page)) {
        rejected("incidental-place-reference");
        continue;
      }
      const photo = licensedPhoto(page.imageinfo?.[0] || {});
      if (!photo) {
        rejected("license-or-quality");
        continue;
      }
      const points = page.coordinates || [];
      const near = points.some((point) =>
        isNearPlace(query, point.lat, point.lon, matchingRadius(query)),
      );
      // A declared file does not need GPS, but a conflicting known location is still evidence against it.
      if (points.length && !near) {
        rejected("coordinate-conflict");
        continue;
      }
      const text = subjectText(page);
      const name = nameEvidence(query, text);
      const area = areaMatch(query.area, text);
      const depicts = query.wikidata && page.depicts?.includes(query.wikidata);
      const matched = [...(candidate.evidence || [])];
      let confidence = 0;
      if (candidate.declared) {
        confidence = 0.99;
        matched.push("declared-file");
      } else if (candidate.entityCategory) {
        confidence = 0.93;
        matched.push("entity-category", "category-membership");
      } else if (candidate.verifiedCategory) {
        confidence = 0.9;
        matched.push("verified-category", "category-membership");
      } else if (depicts) {
        confidence = 0.97;
        matched.push("depicts-entity");
      } else if (name && near) confidence = area ? 0.94 : 0.9;
      else if (name && area) {
        const matchedName =
          name === "alias"
            ? query.aliases?.find((alias) => matchesPlaceName(alias, text))
            : query.name;
        const distinctive = canonicalPlaceName(matchedName || "")
          .split(" ")
          .some((word) => !genericNameWords.has(word));
        confidence = distinctive ? 0.84 : 0;
      }
      if (name) matched.push(name);
      if (near) matched.push("coordinate");
      if (area) matched.push("area");
      if (confidence < 0.8) {
        rejected("insufficient-subject-evidence");
        continue;
      }
      photo.confidence = confidence;
      photo.strategy = candidate.strategy;
      photo.matched = [...new Set(matched)];
      photos.push({ photo, score: confidence + photoQuality(photo) });
    }
    photos.sort(
      (a, b) =>
        b.score - a.score || (b.photo.width || 0) - (a.photo.width || 0),
    );
    return photos[0]?.photo || null;
  };
  const finish = (image: PlacePhoto | null): PhotoResult => {
    diagnostics.strategy = image?.strategy || null;
    diagnostics.elapsedMs = Date.now() - started;
    return {
      image,
      source: image ? "live" : "unavailable",
      diagnostics,
      ...(hadError && !image ? { retryable: true } : {}),
    };
  };
  const files = async (
    titles: string[],
    strategy: string,
    evidence: string[] = [],
  ) => {
    const data = await request(
      "commons.wikimedia.org",
      {
        action: "query",
        titles: titles.slice(0, 4).join("|"),
        redirects: "1",
        ...mediaParams,
      },
      strategy,
    );
    return evaluate(
      ((data?.query?.pages || []) as Page[]).map((page) => ({
        page,
        strategy,
        declared: true,
        evidence,
      })),
    );
  };
  const category = async (
    title: string,
    strategy: string,
    trusted: boolean | "verified",
    evidence: string[] = [],
  ) => {
    const members = async (categoryTitle: string) => {
      const data = await request(
        "commons.wikimedia.org",
        {
          action: "query",
          generator: "categorymembers",
          gcmtitle: categoryTitle,
          gcmtype: "file",
          gcmnamespace: "6",
          gcmlimit: "30",
          ...mediaParams,
        },
        strategy,
      );
      return ((data?.query?.pages || []) as Page[]).map((page) => ({
        page,
        strategy,
        entityCategory: trusted === true,
        verifiedCategory: trusted === "verified",
        evidence,
      }));
    };
    const candidates = await members(title);
    const direct = evaluate(candidates);
    if (direct) return direct;
    // One bounded subcategory level recovers exterior/interior galleries without crawling Commons.
    const subcategories = await request(
      "commons.wikimedia.org",
      {
        action: "query",
        generator: "categorymembers",
        gcmtitle: title,
        gcmtype: "subcat",
        gcmnamespace: "14",
        gcmlimit: "8",
      },
      strategy,
    );
    const subcategoryCandidates: Candidate[] = [];
    for (const page of ((subcategories?.query?.pages || []) as Page[]).slice(
      0,
      2,
    )) {
      if (
        page.title &&
        nameEvidence(query, page.title) &&
        !/\b(?:people|staff|visitors|events|maps|logos|portraits)\b/.test(
          normalize(page.title),
        )
      )
        subcategoryCandidates.push(...(await members(page.title)));
    }
    return evaluate(subcategoryCandidates);
  };
  for (const [value, fileStrategy, categoryStrategy] of [
    [query.osmImage, "osm-image", "osm-image-category"],
    [query.commons, "osm-commons-file", "osm-commons-category"],
  ]) {
    if (!value) continue;
    const ref = commonsReference(value);
    if (!ref) {
      rejected("unlicensed-external-image");
      continue;
    }
    const image = /^Category:/i.test(ref)
      ? await category(ref, categoryStrategy!, true)
      : await files([ref], fileStrategy!);
    if (image) return finish(image);
  }
  let wikipedia = query.wikipedia;
  if (query.wikidata && /^Q[1-9]\d{0,11}$/.test(query.wikidata)) {
    const data = await request(
      "www.wikidata.org",
      {
        action: "wbgetentities",
        ids: query.wikidata,
        props: "labels|aliases|claims|sitelinks",
        languages: "en",
      },
      "wikidata-entity",
    );
    const entity: Entity | undefined = data?.entities?.[query.wikidata];
    const names = [
      ...Object.values(entity?.labels || {}).map((label) => label.value),
      ...Object.values(entity?.aliases || {})
        .flat()
        .map((alias) => alias.value),
    ];
    const coordinates = claimValues(entity, "P625").filter(
      (
        value,
      ): value is { latitude: number; longitude: number; globe: string } =>
        !!value &&
        typeof value === "object" &&
        "latitude" in value &&
        "longitude" in value &&
        "globe" in value &&
        value.globe === "http://www.wikidata.org/entity/Q2",
    );
    const near = coordinates.some((point) =>
      isNearPlace(
        query,
        point.latitude,
        point.longitude,
        matchingRadius(query),
      ),
    );
    const validName = names.some((name) => !!nameEvidence(query, name));
    if ((!coordinates.length || near) && validName) {
      query = {
        ...query,
        aliases: [...new Set([...(query.aliases || []), ...names])].slice(
          0,
          16,
        ),
      };
      const evidence = [
        "declared-entity",
        ...(near ? ["entity-coordinate"] : []),
      ];
      const p18 = claimValues(entity, "P18").filter(
        (file): file is string => typeof file === "string",
      );
      if (p18.length) {
        const image = await files(
          p18.map((file) => `File:${file}`),
          "wikidata-p18",
          evidence,
        );
        if (image) return finish(image);
      }
      const categories = claimValues(entity, "P373").filter(
        (title): title is string => typeof title === "string",
      );
      for (const title of categories.slice(0, 2)) {
        const image = await category(
          `Category:${title.replace(/^Category:/, "")}`,
          "wikidata-p373",
          true,
          evidence,
        );
        if (image) return finish(image);
      }
      wikipedia ||= entity?.sitelinks?.enwiki?.title
        ? `en:${entity.sitelinks.enwiki.title}`
        : undefined;
    } else if (entity)
      rejected(
        coordinates.length && !near
          ? "entity-coordinate-conflict"
          : "entity-name-conflict",
      );
  }
  if (
    wikipedia &&
    /^[a-z]{2,12}:[^\x00-\x1f]{1,180}$/.test(wikipedia) &&
    !/^[a-z]+:\/\//i.test(wikipedia)
  ) {
    const [language, ...title] = wikipedia.split(":");
    const data = await request(
      `${language}.wikipedia.org`,
      {
        action: "query",
        titles: title.join(":"),
        prop: "coordinates|pageimages|pageprops",
        piprop: "name",
        redirects: "1",
      },
      "wikipedia-article",
    );
    const page: Page | undefined = data?.query?.pages?.[0];
    const points = page?.coordinates || [];
    const matched = !!page?.title && !!nameEvidence(query, page.title);
    const near = points.some((point) =>
      isNearPlace(query, point.lat, point.lon, matchingRadius(query)),
    );
    if (page?.pageimage && matched && (!points.length || near)) {
      const image = await files([`File:${page.pageimage}`], "wikipedia-image", [
        "declared-article",
        ...(near ? ["article-coordinate"] : []),
      ]);
      if (image) return finish(image);
    } else if (page?.pageimage)
      rejected(
        points.length && !near
          ? "article-coordinate-conflict"
          : "article-name-conflict",
      );
  }
  const discoveredCategories = new Map<string, string[]>();
  const names = [
    ...new Set([query.name, ...(query.aliases || [])].map(canonicalPlaceName)),
  ].slice(0, 4);
  const safeTerm = (term: string) =>
    term.replace(/["\\|<>]/g, " ").slice(0, 160);
  // Name + town/county queries remain contextual; no general tourism/stock query is ever used.
  const searches = [
    names
      .slice(0, 2)
      .map((name) => `"${safeTerm(name)}"`)
      .join(" OR ") +
      (query.area ? ` ${safeTerm(query.area.split(",")[0])}` : ""),
  ];
  if (query.area || names.length > 2)
    searches.push(names.map((name) => `"${safeTerm(name)}"`).join(" OR "));
  for (const search of searches) {
    const data = await request(
      "commons.wikimedia.org",
      {
        action: "query",
        generator: "search",
        gsrsearch: search,
        gsrnamespace: "6",
        gsrlimit: "24",
        ...mediaParams,
      },
      "commons-search",
    );
    const pages: Page[] = data?.query?.pages || [];
    for (const page of pages)
      for (const item of page.categories || []) {
        if (nameEvidence(query, item.title)) {
          const near = page.coordinates?.some((point) =>
            isNearPlace(query, point.lat, point.lon, matchingRadius(query)),
          );
          if (near || areaMatch(query.area, item.title))
            discoveredCategories.set(
              item.title,
              near ? ["category-coordinate"] : ["category-area"],
            );
        }
      }
    const image = evaluate(
      pages.map((page) => ({ page, strategy: "commons-search" })),
    );
    if (image) return finish(image);
  }
  const geo = await request(
    "commons.wikimedia.org",
    {
      action: "query",
      generator: "geosearch",
      ggscoord: `${query.lat}|${query.lng}`,
      ggsradius: "1000",
      ggsnamespace: "6",
      ggslimit: "30",
      ...mediaParams,
    },
    "commons-geo",
  );
  const geoPages: Page[] = geo?.query?.pages || [];
  // MediaInfo supplies captions and structured depicts claims for otherwise opaque camera filenames.
  const ids = geoPages
    .filter((page) => page.pageid && !nameEvidence(query, subjectText(page)))
    .slice(0, 20)
    .map((page) => `M${page.pageid}`);
  if (ids.length) {
    const media = await request(
      "commons.wikimedia.org",
      {
        action: "wbgetentities",
        ids: ids.join("|"),
        props: "labels|claims",
        languages: "en",
      },
      "commons-mediainfo",
    );
    for (const page of geoPages) {
      const entity: Entity | undefined = media?.entities?.[`M${page.pageid}`];
      page.caption = Object.values(entity?.labels || {})
        .map((label) => label.value)
        .join(" ");
      page.depicts = claimValues(entity, "P180")
        .filter(
          (value): value is { id: string } =>
            !!value &&
            typeof value === "object" &&
            "id" in value &&
            typeof value.id === "string",
        )
        .map((value) => value.id);
    }
  }
  const geoImage = evaluate(
    geoPages.map((page) => ({ page, strategy: "commons-geo" })),
  );
  if (geoImage) return finish(geoImage);
  for (const page of geoPages)
    for (const item of page.categories || [])
      if (
        nameEvidence(query, item.title) &&
        page.coordinates?.some((point) =>
          isNearPlace(query, point.lat, point.lon, matchingRadius(query)),
        )
      )
        discoveredCategories.set(item.title, ["category-coordinate"]);
  // Exact named categories are promoted only after town or coordinate corroboration.
  for (const [title, evidence] of [...discoveredCategories].slice(0, 2)) {
    const image = await category(
      title,
      "commons-category",
      "verified",
      evidence,
    );
    if (image) return finish(image);
  }
  return finish(null);
}

export async function lookupPlacePhoto(
  query: PhotoQuery,
  options: { refresh?: boolean; debug?: boolean } = {},
): Promise<PhotoResult> {
  const key = JSON.stringify([
    normalize(query.name),
    query.lat.toFixed(4),
    query.lng.toFixed(4),
    query.wikidata,
    query.wikipedia,
    query.id,
    query.area,
    query.aliases,
    query.osmImage,
    query.commons,
    query.category,
  ]);
  const present = (result: PhotoResult): PhotoResult =>
    options.debug
      ? result
      : {
          image: result.image,
          source: result.source,
          ...(result.retryable ? { retryable: true } : {}),
        };
  const hit = cache.get(key);
  if (!options.refresh && hit && hit.expires > Date.now())
    return present({
      ...hit.result,
      source: "cached",
      diagnostics: hit.result.diagnostics && {
        ...hit.result.diagnostics,
        cacheHit: true,
      },
    });
  const existing = pending.get(key);
  if (existing) return present(await existing);
  if (active >= 6)
    return {
      image: null,
      source: "unavailable",
      retryable: true,
      ...(options.debug
        ? {
            diagnostics: {
              strategy: null,
              sourcesAttempted: [],
              candidateCount: 0,
              rejected: { "concurrency-limit": 1 },
              requestCount: 0,
              elapsedMs: 0,
            },
          }
        : {}),
    };
  active++;
  const promise = resolve(query)
    .then((result) => {
      if (cache.size >= 1000) cache.delete(cache.keys().next().value!);
      cache.set(key, {
        result,
        expires:
          Date.now() +
          (result.image
            ? 24 * 60 * 60_000
            : result.retryable
              ? 30_000
              : 5 * 60_000),
      });
      return result;
    })
    .finally(() => {
      active--;
      pending.delete(key);
    });
  pending.set(key, promise);
  return present(await promise);
}
