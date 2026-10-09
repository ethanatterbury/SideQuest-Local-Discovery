import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import type { PhotoQuery, PlacePhoto } from "./place-photo";

/** This adapter runs on the server. Website images retain their owner's rights. */
export type OfficialPhotoQuery = PhotoQuery & { address?: string };
export interface OfficialPhotoCandidate extends PlacePhoto {
  rank: number;
  evidence: string[];
  photoScore: number;
  subjectEvidence: string[];
}
export interface OfficialPhotoSubjectAssessment {
  accepted: boolean;
  photoScore: number;
  subjectEvidence: string[];
  rejection: string | null;
}
export interface OfficialPhotoIdentity {
  matchedName: boolean;
  matchedArea: boolean;
  matchedAddress: boolean;
  multiBranch: boolean;
  branchSpecific: boolean;
  evidence: string[];
}
export interface OfficialPhotoParseResult {
  candidates: OfficialPhotoCandidate[];
  identity: OfficialPhotoIdentity;
  rejected: Record<string, number>;
}
export interface OfficialPhotoResult extends OfficialPhotoParseResult {
  pageUrl: string | null;
  reason: string | null;
  requestCount: number;
  retryable: boolean;
  elapsedMs: number;
}
export type OfficialPhotoLookup = (
  hostname: string,
) => Promise<{ address: string; family: number }[]>;
export interface OfficialPhotoOptions {
  /** Dependency injection; production requests use DNS-pinned node:https. */
  fetch?: typeof fetch;
  lookup?: OfficialPhotoLookup;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxCandidates?: number;
}
export interface OfficialPhotoDownload {
  buffer: Buffer;
  contentType: string;
  url: string;
}

const HTML_LIMIT = 2_000_000;
const MAX_REDIRECTS = 4;
const MAX_IMAGES = 160;
const chainNames =
  /\b(?:starbucks|costa|caffe nero|pret a manger|mcdonalds|kfc|burger king|nandos|wagamama|pizza express|pizzaexpress|zizzi|prezzo|five guys|greggs|subway|odeon|vue|cineworld|everyman|hollywood bowl|tenpin|go ape|puregym|the gym group|anytime fitness|david lloyd|bannatyne|nuffield|national trust|english heritage|forest holidays|wetherspoon|harvester|toby carvery|beefeater|brewers fayre|greene king|fullers|youngs)\b/i;
const physicalSceneWords =
  /\b(?:interior|exterior|courtyard|terrace|building|entrance|facade|frontage|shop front|dining (?:room|area)|seating (?:area|space)|beer garden|grounds|landscape|playground|play (?:area|frame)|soft play frame|woodland|footpath|walking trail|lake|fairway|golf course|auditorium|reception|lobby|swimming pool|gym floor|fitness studio|exercise equipment|inside|outside)\b/i;
const foodWords =
  /\b(?:food|burger|pizza|steak|sirloin|sushi|noodles?|dishes?|curry|pasta|pancakes?|waffles?|cocktails?|beverages?|drinks?|latte|cappuccino|coffee beans|ice cream|desserts?|cakes?|menu|plates?|takeaway|delivery|uber eats|ubereats)\b/i;
const artworkWords =
  /\b(?:logo|logos|logotype|icon|icons|favicon|brand mark|branding|illustration|mascot|cartoon|clipart|graphic|artwork|poster|flyer|brochure|infographic|app store|appstore|play store|download app|allergy|allergen|sponsor|voucher|gift card|special offer|offers?|discount|deals?|promotion|promo|sale|percent off|off food|live music|tribute|band night|book now)\b/i;
const portraitWords =
  /\b(?:portrait|headshot|staff|team|chef|barista|instructor|personal trainer)\b/i;
const galleryWords =
  /\b(?:gallery|galleries|lightbox|wordpress gallery|venue photos|location photos)\b/i;
const excludedWords =
  /(?:^|[\s/_.-])(?:logo|logos|logotype|icon|icons|favicon|sprite|placeholder|avatar|badge|payment|visa|mastercard|spinner|loader|loading|pixel|tracking|qr[ _-]?code|menu(?:[ _-]?(?:pdf|cover))?|gift[ _-]?card|voucher|award|social[ _-]?share|allergy|allergen|sponsor|poster|flyer|brochure|infographic|illustration|mascot|clipart)(?:$|[\s/_.-])/i;
const stockHosts =
  /(?:^|\.)(?:unsplash\.com|pexels\.com|pixabay\.com|shutterstock\.com|istockphoto\.com|gettyimages\.com|freepik\.com)$/i;

function decode(value: string): string {
  return value.replace(
    /&(?:amp|quot|apos|lt|gt|nbsp|#\d+|#x[\da-f]+);/gi,
    (entity) => {
      const named: Record<string, string> = {
        amp: "&",
        quot: '"',
        apos: "'",
        lt: "<",
        gt: ">",
        nbsp: " ",
      };
      const body = entity.slice(1, -1).toLowerCase();
      if (named[body]) return named[body];
      const code = body.startsWith("#x")
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    },
  );
}
function plain(value: string): string {
  return decode(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}
function normalized(value: string): string {
  return plain(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b([\p{L}]{3,})[’']s\b/gu, "$1")
    .replace(/\bcenter\b/g, "centre")
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
function contains(text: string, value: string): boolean {
  const needle = normalized(value).replace(/^the /, "");
  const haystack = normalized(text);
  if (needle.length < 3) return false;
  if (` ${haystack} `.includes(` ${needle} `)) return true;
  // Operators sometimes join the words of a brand in titles (PiratesLanding).
  const compact = needle.replace(/ /g, "");
  if (compact.length < 6) return false;
  const words = haystack.split(" ");
  return words.some((_, start) => {
    let joined = "";
    for (
      let end = start;
      end < words.length && joined.length < compact.length;
      end++
    )
      joined += words[end];
    return joined === compact;
  });
}
function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pattern = /([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(pattern))
    result[match[1].toLowerCase()] = decode(
      match[2] ?? match[3] ?? match[4] ?? "",
    );
  return result;
}
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  return [];
}

/** Reject non-global addresses, including IPv4-mapped IPv6 and special-use blocks. */
export function isPublicPhotoAddress(address: string): boolean {
  const host = address.replace(/^\[|\]$/g, "").toLowerCase();
  const family = isIP(host);
  if (family === 4) {
    const [a, b, c] = host.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 &&
        (b === 168 ||
          b === 0 ||
          (b === 88 && c === 99) ||
          (b === 2 && c === 0))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  // Global unicast only. Reject transition mechanisms and documentation ranges.
  if (family === 6) {
    const [first, second] = host
      .split(":")
      .map((part) => parseInt(part || "0", 16));
    return (
      first >= 0x2000 &&
      first < 0x3fff &&
      first !== 0x2002 &&
      !(first === 0x2001 && (second < 0x200 || second === 0xdb8))
    );
  }
  return false;
}

/** Syntactic guard; resolveOfficialPhotos also checks every DNS answer before I/O. */
export function safeOfficialPhotoUrl(value: string): boolean {
  if (!value || value.length > 4096 || /[\\\x00-\x20\x7f]/.test(value))
    return false;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !/(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(
        host,
      ) &&
      (isIP(host)
        ? isPublicPhotoAddress(host)
        : host.includes(".") && !/^\d+$/.test(host))
    );
  } catch {
    return false;
  }
}
function imageUrl(raw: string, base: string): string | null {
  try {
    const url = new URL(
      decode(raw)
        .replace(/\\\//g, "/")
        .replace(/\{width\}/g, "1200"),
      base,
    );
    url.hash = "";
    if (
      !safeOfficialPhotoUrl(url.href) ||
      stockHosts.test(url.hostname) ||
      /(?:maps\.google|maps\.googleapis|maps\.gstatic|googleusercontent|tile\.openstreetmap|mapbox)/i.test(
        url.hostname,
      ) ||
      /\.(?:svg|gif|ico|pdf)(?:$|\?)/i.test(url.href)
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
type RawImage = {
  raw: string;
  context: string;
  kind: string;
  width?: number;
  height?: number;
  business?: Record<string, unknown>;
};
function dimension(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= 30_000 ? n : undefined;
}
function srcset(value: string): { raw: string; width?: number }[] {
  return value
    .split(/,\s*(?=\S)/)
    .map((entry) => {
      const match = /^(\S+)(?:\s+(\d+(?:\.\d+)?)(w|x))?$/.exec(entry.trim());
      return {
        raw: match?.[1] ?? "",
        width: match?.[3] === "w" ? dimension(match[2]) : undefined,
      };
    })
    .filter((entry) => entry.raw)
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
}

/** A hero, business logo or food photograph does not establish what a venue looks like. */
export function assessOfficialPhotoSubject(
  image: {
    url: string;
    context?: string;
    kind?: string;
    width?: number;
    height?: number;
  },
  query: OfficialPhotoQuery,
): OfficialPhotoSubjectAssessment {
  let filename: string;
  try {
    filename = decodeURIComponent(new URL(image.url).pathname);
  } catch {
    filename = image.url;
  }
  const readable = (value: string) =>
    normalized(value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\+/g, " "));
  const subject = `${readable(filename)} ${readable(image.context ?? "")}`;
  const denied = (rejection: string): OfficialPhotoSubjectAssessment => ({
    accepted: false,
    photoScore: 0,
    subjectEvidence: [],
    rejection,
  });
  if (artworkWords.test(subject)) return denied("artwork-or-promotion");
  const physical = physicalSceneWords.test(subject);
  if (foodWords.test(subject) && !physical)
    return denied("food-or-drink-subject");
  if (portraitWords.test(subject) && !physical) return denied("person-subject");
  const gallery = galleryWords.test(subject);
  const photographicFormat = /\.(?:jpe?g|webp|avif)(?:$|[?#])/i.test(image.url);
  const outdoorCategory =
    /\b(?:park|nature reserve|woodland|garden|lake|golf|historic|castle|heritage|landmark|trail|country house)\b/i.test(
      query.category ?? "",
    );
  const namedOutdoor =
    outdoorCategory &&
    photographicFormat &&
    contains(filename.replace(/\+/g, " "), query.name);
  const evidence = [
    ...(physical ? ["physical venue scene in image metadata"] : []),
    ...(gallery && photographicFormat
      ? ["photographic venue gallery asset"]
      : []),
    ...(namedOutdoor ? ["named outdoor attraction photograph"] : []),
  ];
  const photoScore = physical
    ? 90
    : namedOutdoor
      ? 75
      : gallery && photographicFormat
        ? 60
        : 0;
  return {
    accepted: photoScore >= 60,
    photoScore,
    subjectEvidence: evidence,
    rejection: photoScore >= 60 ? null : "unconfirmed-photo-subject",
  };
}

/** Importers can refuse older, ungated candidate records as well as weak subjects. */
export function officialPhotoCandidateAllowed(
  candidate: Pick<OfficialPhotoCandidate, "photoScore" | "subjectEvidence">,
): boolean {
  return (
    Number.isFinite(candidate.photoScore) &&
    candidate.photoScore >= 60 &&
    Array.isArray(candidate.subjectEvidence) &&
    candidate.subjectEvidence.length > 0
  );
}

/** Pure, bounded extraction. Candidates describe evidence, never assert a reusable licence. */
export function parseOfficialPhotoHtml(
  html: string,
  pageUrl: string,
  query: OfficialPhotoQuery,
): OfficialPhotoParseResult {
  html = html.slice(0, HTML_LIMIT);
  const rejected: Record<string, number> = {};
  const reject = (reason: string) => {
    rejected[reason] = (rejected[reason] ?? 0) + 1;
  };
  const raw: RawImage[] = [];
  const businesses: Record<string, unknown>[] = [];
  const headings = [
    ...html.matchAll(/<(?:title|h1)\b[^>]*>([\s\S]*?)<\/(?:title|h1)>/gi),
  ]
    .map((match) => plain(match[1]))
    .join(" ");
  const metas: Record<string, string> = {};
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attr = attributes(match[0]);
    const key = (attr.property ?? attr.name ?? "").toLowerCase();
    if (attr.content && !metas[key]) metas[key] = attr.content;
  }
  const primary = `${headings} ${metas["og:title"] ?? ""} ${metas["og:description"] ?? ""} ${metas.description ?? ""} ${metas["twitter:title"] ?? ""} ${decode(new URL(pageUrl).pathname)}`;
  const names = [query.name, ...(query.aliases ?? [])].flatMap((name) => {
    const simplified = normalized(name).replace(
      /\s+(?:(?:chinese|italian|indian|thai)\s+)?(?:restaurant|cafe|coffee shop|pub|sail(?:ing)? training centre|soft play(?: centre)?)$/,
      "",
    );
    return simplified.length >= 6 && simplified !== normalized(name)
      ? [name, simplified]
      : [name];
  });
  // Structured LocalBusiness images carry stronger subject evidence than Organization branding.
  function walk(value: unknown, depth = 0): void {
    if (depth > 10) return;
    if (Array.isArray(value)) {
      for (const child of value.slice(0, 100)) walk(child, depth + 1);
      return;
    }
    const node = object(value);
    if (!node) return;
    const type = strings(node["@type"]).join(" ");
    const business =
      /(?:LocalBusiness|Restaurant|CafeOrCoffeeShop|FoodEstablishment|Museum|TouristAttraction|Park|SportsActivityLocation|ExerciseGym|MovieTheater|Hotel|BarOrPub)/i.test(
        type,
      );
    if (business) businesses.push(node);
    const addImage = (value: unknown): void => {
      if (typeof value === "string")
        raw.push({
          raw: value,
          context: String(node.name ?? ""),
          kind: business ? "schema-venue" : "schema",
          business: business ? node : undefined,
        });
      else if (Array.isArray(value)) value.slice(0, 30).forEach(addImage);
      else {
        const img = object(value);
        if (img)
          for (const url of strings(img.contentUrl ?? img.url))
            raw.push({
              raw: url,
              kind: business ? "schema-venue" : "schema",
              context: `${node.name ?? ""} ${img.caption ?? ""} ${img.description ?? ""}`,
              width: dimension(img.width),
              height: dimension(img.height),
              business: business ? node : undefined,
            });
      }
    };
    if (node.image) addImage(node.image);
    for (const [key, child] of Object.entries(node))
      if (key !== "image" && key !== "logo") walk(child, depth + 1);
  }
  for (const match of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
  )) {
    if (!/application\/ld\+json/i.test(attributes(match[1]).type ?? ""))
      continue;
    try {
      walk(JSON.parse(match[2]));
    } catch {
      reject("invalid-schema");
    }
  }
  const pageNamed = names.some((name) => contains(primary, name));
  const matchedBusiness = businesses.filter((business) => {
    if (names.some((name) => contains(String(business.name ?? ""), name)))
      return true;
    // Chains often name their Restaurant schema only after the local branch.
    if (
      !pageNamed ||
      !query.area ||
      !contains(String(business.name ?? ""), query.area)
    )
      return false;
    try {
      return (
        new URL(String(business.url ?? ""), pageUrl).href.replace(/\/$/, "") ===
        pageUrl.replace(/\/$/, "")
      );
    } catch {
      return false;
    }
  });
  const businessText = matchedBusiness
    .map((business) => JSON.stringify(business.address ?? ""))
    .join(" ");
  const matchedName =
    names.some((name) => contains(primary, name)) || matchedBusiness.length > 0;
  const matchedArea =
    !!query.area &&
    (contains(primary, query.area) || contains(businessText, query.area));
  const matchedAddress =
    !!query.address && contains(`${primary} ${businessText}`, query.address);
  const visible = plain(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " "),
  );
  const multiBranch =
    chainNames.test(normalized(query.name)) ||
    /\b(?:find (?:a|your) (?:store|branch|restaurant|gym)|our (?:locations|branches|restaurants|cinemas)|store locator|location finder|across (?:the )?(?:uk|united kingdom)|nationwide)\b/i.test(
      visible,
    ) ||
    matchedBusiness.length > 1;
  const branchSpecific =
    matchedName && (!multiBranch || matchedArea || matchedAddress);
  const identity: OfficialPhotoIdentity = {
    matchedName,
    matchedArea,
    matchedAddress,
    multiBranch,
    branchSpecific,
    evidence: [
      ...(matchedName
        ? ["venue name in page title, heading or business schema"]
        : []),
      ...(matchedArea
        ? ["venue area in page metadata, path or business address"]
        : []),
      ...(matchedAddress ? ["venue address matched"] : []),
      ...(multiBranch ? ["multi-branch operator"] : []),
    ],
  };
  for (const [key, kind] of [
    ["og:image", "open-graph"],
    ["og:image:secure_url", "open-graph"],
    ["twitter:image", "twitter"],
    ["twitter:image:src", "twitter"],
  ]) {
    if (metas[key])
      raw.push({
        raw: metas[key],
        kind,
        context: metas["og:image:alt"] ?? metas["twitter:image:alt"] ?? "",
        width: dimension(metas["og:image:width"]),
        height: dimension(metas["og:image:height"]),
      });
  }
  const withoutScripts = html.replace(
    /<script\b[^>]*>[\s\S]*?<\/script>/gi,
    (value) => " ".repeat(value.length),
  );
  for (const match of withoutScripts.matchAll(/<(?:img|source)\b[^>]*>/gi)) {
    const attr = attributes(match[0]);
    const before = withoutScripts.slice(
      Math.max(0, match.index! - 800),
      match.index,
    );
    const parent =
      [...before.matchAll(/<(?:div|section|figure|picture|a|li)\b[^>]*>/gi)].at(
        -1,
      )?.[0] ?? "";
    const wordpressGallery =
      /attachment-thumbnail|size-thumbnail/.test(attr.class ?? "") &&
      /\.jpe?g(?:$|\?)/i.test(attr.src ?? "") &&
      !!(attr.srcset || attr["data-srcset"]);
    const parentAttr = attributes(parent);
    const parentContext = `${parentAttr.class ?? ""} ${parentAttr.id ?? ""} ${parentAttr["aria-label"] ?? ""}`;
    const context = `${attr.alt ?? ""} ${attr.title ?? ""} ${attr.class ?? ""} ${attr.id ?? ""} ${parentContext} ${wordpressGallery ? "WordPress gallery" : ""}`;
    const width = dimension(attr.width),
      height = dimension(attr.height);
    for (const key of [
      "data-src",
      "data-lazy-src",
      "data-original",
      "data-image",
      "data-lazy",
      "src",
    ])
      if (attr[key])
        raw.push({ raw: attr[key], context, kind: "body", width, height });
    // WordPress galleries expose their originals beside small cropped thumbnails.
    for (const key of ["data-large_image", "data-full-url", "data-orig-file"])
      if (attr[key])
        raw.push({
          raw: attr[key],
          context: `${context} gallery`,
          kind: "body",
          width: dimension(attr["data-large_image_width"]),
          height: dimension(attr["data-large_image_height"]),
        });
    const anchor = [...before.matchAll(/<a\b[^>]*>/gi)].at(-1);
    if (
      anchor &&
      !/<\/a\s*>/i.test(before.slice(anchor.index! + anchor[0].length))
    ) {
      const href = attributes(anchor[0]).href;
      if (href && /\.(?:jpe?g|png|webp|avif)(?:$|[?#])/i.test(href))
        raw.push({ raw: href, context: `${context} gallery`, kind: "body" });
    }
    for (const key of ["data-srcset", "data-lazy-srcset", "srcset"])
      if (attr[key])
        for (const image of srcset(attr[key]).slice(0, 3))
          raw.push({
            ...image,
            context,
            kind: "body",
            height:
              width && height && image.width
                ? Math.round((height * image.width) / width)
                : height,
          });
  }
  for (const match of withoutScripts.matchAll(
    /<[^>]+\bdata-(?:background(?:-image)?|bg|bgset|lazy-background)\s*=[^>]*>/gi,
  )) {
    const attr = attributes(match[0]);
    const context = `${attr.class ?? ""} ${attr.id ?? ""} ${attr["aria-label"] ?? ""} background`;
    for (const key of [
      "data-background",
      "data-background-image",
      "data-bg",
      "data-lazy-background",
    ])
      if (attr[key]) raw.push({ raw: attr[key], kind: "background", context });
    if (attr["data-bgset"])
      for (const image of srcset(attr["data-bgset"]).slice(0, 3))
        raw.push({ ...image, kind: "background", context });
  }
  for (const match of withoutScripts.matchAll(
    /(?:background(?:-image)?\s*:)[^;{}<>]{0,500}?url\(\s*(["']?)([^)'"\s]+)\1\s*\)/gi,
  )) {
    const start = withoutScripts.lastIndexOf("<", match.index);
    const end = withoutScripts.indexOf(">", match.index);
    const attr = attributes(withoutScripts.slice(start, end + 1));
    const context = `${attr.class ?? ""} ${attr.id ?? ""} ${attr.title ?? ""} ${attr["aria-label"] ?? ""}`;
    raw.push({ raw: match[2], kind: "background", context });
  }
  // Wix/Squarespace hydration often contains originals absent from <img src>.
  // JSON-LD images were already extracted with their owning business attached.
  const hydrationHtml = html.replace(
    /<script\b([^>]*)>[\s\S]*?<\/script>/gi,
    (script, attrs: string) =>
      /application\/ld\+json/i.test(attributes(attrs).type ?? "")
        ? " ".repeat(script.length)
        : script,
  );
  for (const match of hydrationHtml.matchAll(
    /"(?:imageUrl|imageURL|image_url|originalUrl|contentUrl|assetUrl|fullUrl|url)"\s*:\s*"(https?(?:[^"\\]|\\.){1,2048})"/g,
  )) {
    const context = hydrationHtml.slice(
      Math.max(0, match.index! - 250),
      match.index! + match[0].length + 150,
    );
    try {
      raw.push({
        raw: JSON.parse(`"${match[1]}"`),
        kind: "gallery-data",
        context,
      });
    } catch {
      /* malformed hydration */
    }
  }
  for (const match of hydrationHtml.matchAll(
    /"uri"\s*:\s*"([\w~-]+\.(?:jpg|jpeg|png|webp))"/gi,
  ))
    raw.push({
      raw: `https://static.wixstatic.com/media/${match[1]}`,
      kind: "gallery-data",
      context: hydrationHtml.slice(
        Math.max(0, match.index! - 200),
        match.index! + 300,
      ),
    });

  const photos = new Map<string, OfficialPhotoCandidate>();
  const bodyUrls = new Set(
    raw
      .filter((item) => item.kind === "body" || item.kind === "background")
      .map((item) => imageUrl(item.raw, pageUrl))
      .filter(Boolean),
  );
  for (const item of raw.slice(0, 1200)) {
    const url = imageUrl(item.raw, pageUrl);
    if (!url) {
      reject("unsafe-or-unsupported-image");
      continue;
    }
    if (
      ["gallery-data", "schema", "schema-venue"].includes(item.kind) &&
      !/\.(?:jpe?g|png|webp|avif|heic|heif)(?:$|\?)/i.test(url) &&
      !/(?:images\.ctfassets\.net|imagedelivery\.net|res\.cloudinary\.com)\//i.test(
        url,
      )
    ) {
      reject("not-image-url");
      continue;
    }
    let filename = new URL(url).pathname;
    try {
      filename = decodeURIComponent(filename);
    } catch {
      /* Invalid escapes do not invalidate the whole page. */
    }
    filename = filename.replace(/[+_-]/g, " ");
    const subject = `${filename} ${item.context}`;
    if (
      excludedWords.test(`${filename} ${item.context}`) ||
      /\b(?:static[ _-]?map|google[ _-]?map|stock[ _-]?(?:image|photo)|shutterstock|istock|unsplash|pexels)\b/i.test(
        subject,
      )
    ) {
      reject("branding-map-or-stock");
      continue;
    }
    if (
      (item.width && item.width < 350) ||
      (item.height && item.height < 220) ||
      (item.width &&
        item.height &&
        (item.width / item.height > 4 || item.height / item.width > 4))
    ) {
      reject("small-or-banner-art");
      continue;
    }
    if (!branchSpecific) {
      reject(matchedName ? "unconfirmed-branch" : "unconfirmed-venue");
      continue;
    }
    if (item.business && !matchedBusiness.includes(item.business)) {
      reject("different-schema-venue");
      continue;
    }
    const schemaVenue = item.kind === "schema-venue" && !!item.business;
    const onPage = bodyUrls.has(url);
    const assessment = assessOfficialPhotoSubject(
      {
        url,
        context: item.context,
        kind: item.kind,
        width: item.width,
        height: item.height,
      },
      query,
    );
    if (!assessment.accepted) {
      reject(assessment.rejection ?? "unconfirmed-photo-subject");
      continue;
    }
    const rank =
      assessment.photoScore * 10 +
      (schemaVenue ? 5 : 0) +
      (onPage ? 8 : 0) +
      (["open-graph", "twitter"].includes(item.kind) ? 3 : 0) +
      (matchedArea || matchedAddress ? 5 : 0) +
      Math.min(5, (item.width ?? 800) / 400);
    const evidence = [
      item.kind,
      ...identity.evidence,
      ...assessment.subjectEvidence,
      ...(schemaVenue ? ["matching LocalBusiness image"] : []),
      ...(onPage ? ["image occurs in page content"] : []),
    ];
    const candidate: OfficialPhotoCandidate = {
      url,
      source: pageUrl,
      credit: query.name,
      license: "Venue website — rights reserved",
      width: item.width,
      height: item.height,
      confidence: Math.min(0.95, 0.6 + assessment.photoScore / 300),
      strategy: "official-website",
      matched: evidence,
      rank,
      evidence,
      photoScore: assessment.photoScore,
      subjectEvidence: assessment.subjectEvidence,
    };
    const previous = photos.get(url);
    if (!previous || candidate.rank > previous.rank) photos.set(url, candidate);
  }
  return {
    candidates: [...photos.values()]
      .sort((a, b) => b.rank - a.rank)
      .slice(0, MAX_IMAGES),
    identity,
    rejected,
  };
}

class OfficialPhotoError extends Error {
  constructor(
    readonly reason: string,
    readonly retryable = false,
  ) {
    super(reason);
  }
}
function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted)
    return Promise.reject(new OfficialPhotoError("timeout-or-abort", true));
  let abort = () => {};
  const canceled = new Promise<never>((_, reject) => {
    abort = () => reject(new OfficialPhotoError("timeout-or-abort", true));
    signal.addEventListener("abort", abort, { once: true });
  });
  return Promise.race([promise, canceled]).finally(() =>
    signal.removeEventListener("abort", abort),
  );
}
function cancel(response: Response): void {
  void response.body?.cancel().catch(() => {});
}
async function publicAddresses(
  url: URL,
  lookup: OfficialPhotoLookup,
  signal: AbortSignal,
) {
  if (!safeOfficialPhotoUrl(url.href))
    throw new OfficialPhotoError("unsafe-url");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await bounded(lookup(host), signal);
  if (
    !addresses.length ||
    addresses.some((entry) => !isPublicPhotoAddress(entry.address))
  )
    throw new OfficialPhotoError("unsafe-dns-address");
  return addresses;
}
/** DNS pinning closes the check-then-fetch DNS rebinding gap. */
function pinnedRequest(
  url: URL,
  addresses: { address: string; family: number }[],
  signal: AbortSignal,
  accept = "text/html,application/xhtml+xml",
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: "GET",
        signal,
        agent: false,
        lookup: (_hostname, options, callback) =>
          options.all
            ? callback(null, addresses)
            : callback(null, addresses[0].address, addresses[0].family),
        headers: {
          Accept: accept,
          "Accept-Encoding": "identity",
          "User-Agent":
            "SideQuest/1.0 (venue photo metadata; https://sidequest-local-discovery.vercel.app)",
        },
      },
      (res) => {
        try {
          const headers = new Headers();
          for (const [key, value] of Object.entries(res.headers))
            if (value !== undefined)
              headers.set(key, Array.isArray(value) ? value.join(", ") : value);
          const status = res.statusCode ?? 502;
          if ([204, 205, 304].includes(status)) {
            res.resume();
            resolve(new Response(null, { status, headers }));
          } else {
            const body = Readable.toWeb(res) as ReadableStream<Uint8Array>;
            resolve(new Response(body, { status, headers }));
          }
        } catch (error) {
          res.destroy();
          reject(error);
        }
      },
    );
    req.on("error", reject);
    req.end();
  });
}
async function readHtml(
  response: Response,
  signal: AbortSignal,
): Promise<string> {
  if (Number(response.headers.get("content-length")) > HTML_LIMIT) {
    cancel(response);
    throw new OfficialPhotoError("html-too-large");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await bounded(reader.read(), signal);
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > HTML_LIMIT) throw new OfficialPhotoError("html-too-large");
      chunks.push(part.value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export async function resolveOfficialPhotos(
  query: OfficialPhotoQuery,
  options: OfficialPhotoOptions = {},
): Promise<OfficialPhotoResult> {
  const started = Date.now();
  const controller = new AbortController();
  const signal = controller.signal;
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timeout = Math.min(30_000, Math.max(1, options.timeoutMs ?? 12_000));
  const timer = setTimeout(onAbort, timeout);
  const lookup: OfficialPhotoLookup =
    options.lookup ??
    ((host) => dnsLookup(host, { all: true, verbatim: true }));
  let requestCount = 0,
    pageUrl: string | null = null;
  const empty: OfficialPhotoParseResult = {
    candidates: [],
    rejected: {},
    identity: {
      matchedName: false,
      matchedArea: false,
      matchedAddress: false,
      multiBranch: false,
      branchSpecific: false,
      evidence: [],
    },
  };
  try {
    if (!query.website) throw new OfficialPhotoError("missing-website");
    // Historic OSM websites often use http; request only their HTTPS endpoint.
    const website = query.website.replace(/^http:\/\//i, "https://");
    if (!safeOfficialPhotoUrl(website))
      throw new OfficialPhotoError("unsafe-url");
    let url = new URL(website);
    url.hash = "";
    let response: Response;
    for (let redirects = 0; ; redirects++) {
      const addresses = await publicAddresses(url, lookup, signal);
      requestCount++;
      const operation = options.fetch
        ? options.fetch(url.href, {
            signal,
            redirect: "manual",
            cache: "no-store",
            headers: { Accept: "text/html,application/xhtml+xml" },
          })
        : pinnedRequest(url, addresses, signal);
      void operation.then(
        (res) => {
          if (signal.aborted) cancel(res);
        },
        () => {},
      );
      response = await bounded(operation, signal);
      if (response.url && response.url !== url.href) {
        cancel(response);
        throw new OfficialPhotoError("unexpected-redirect");
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        cancel(response);
        if (
          !location ||
          redirects >= MAX_REDIRECTS ||
          /[\\\x00-\x20\x7f]/.test(location)
        )
          throw new OfficialPhotoError("unsafe-redirect");
        url = new URL(location, url);
        if (!safeOfficialPhotoUrl(url.href))
          throw new OfficialPhotoError("unsafe-redirect");
        continue;
      }
      break;
    }
    pageUrl = url.href;
    if (!response.ok) {
      cancel(response);
      throw new OfficialPhotoError(
        `website-http-${response.status}`,
        response.status === 429 || response.status >= 500,
      );
    }
    if (
      !/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(
        response.headers.get("content-type") ?? "",
      )
    ) {
      cancel(response);
      throw new OfficialPhotoError("website-content-type");
    }
    const parsed = parseOfficialPhotoHtml(
      await readHtml(response, signal),
      pageUrl,
      query,
    );
    // Check public DNS for candidate CDNs too; no arbitrary private image URLs escape.
    const verified: OfficialPhotoCandidate[] = [];
    const guards = new Map<string, Promise<boolean>>();
    const max = Math.min(MAX_IMAGES, Math.max(1, options.maxCandidates ?? 12));
    for (const candidate of parsed.candidates.slice(0, Math.max(max * 3, 24))) {
      const image = new URL(candidate.url);
      let guard = guards.get(image.hostname);
      if (!guard) {
        guard = publicAddresses(image, lookup, signal).then(
          () => true,
          (error) => {
            if (signal.aborted) throw error;
            return false;
          },
        );
        guards.set(image.hostname, guard);
      }
      if (await guard) verified.push(candidate);
      else
        parsed.rejected["unsafe-image-dns"] =
          (parsed.rejected["unsafe-image-dns"] ?? 0) + 1;
      if (verified.length >= max) break;
    }
    return {
      ...parsed,
      candidates: verified,
      pageUrl,
      reason: verified.length
        ? null
        : !parsed.identity.branchSpecific
          ? "unconfirmed-venue-or-branch"
          : "no-venue-photo",
      requestCount,
      retryable: false,
      elapsedMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ...empty,
      pageUrl,
      reason:
        error instanceof OfficialPhotoError
          ? error.reason
          : signal.aborted
            ? "timeout-or-abort"
            : "website-network",
      requestCount,
      retryable: error instanceof OfficialPhotoError ? error.retryable : true,
      elapsedMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

/** Server-side ingestion only: pinned public DNS, manual redirects and an 8 MB image cap. */
export async function downloadOfficialPhoto(
  value: string,
  options: OfficialPhotoOptions = {},
): Promise<OfficialPhotoDownload | null> {
  const controller = new AbortController();
  const signal = controller.signal;
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(
    onAbort,
    Math.min(30_000, Math.max(1, options.timeoutMs ?? 12_000)),
  );
  const lookup: OfficialPhotoLookup =
    options.lookup ??
    ((host) => dnsLookup(host, { all: true, verbatim: true }));
  const limit = 8_000_000;
  const accept = "image/jpeg,image/png,image/webp,image/avif";
  try {
    if (!safeOfficialPhotoUrl(value)) return null;
    let url = new URL(value);
    url.hash = "";
    let response: Response;
    for (let redirects = 0; ; redirects++) {
      const addresses = await publicAddresses(url, lookup, signal);
      const operation = options.fetch
        ? options.fetch(url.href, {
            signal,
            redirect: "manual",
            cache: "no-store",
            headers: { Accept: accept },
          })
        : pinnedRequest(url, addresses, signal, accept);
      void operation.then(
        (res) => {
          if (signal.aborted) cancel(res);
        },
        () => {},
      );
      response = await bounded(operation, signal);
      if (response.url && response.url !== url.href) {
        cancel(response);
        return null;
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        cancel(response);
        if (
          !location ||
          redirects >= MAX_REDIRECTS ||
          /[\\\x00-\x20\x7f]/.test(location)
        )
          return null;
        url = new URL(location, url);
        if (!safeOfficialPhotoUrl(url.href)) return null;
        continue;
      }
      break;
    }
    const contentType = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (
      !response.ok ||
      !/^image\/(?:jpeg|png|webp|avif)$/.test(contentType) ||
      Number(response.headers.get("content-length")) > limit ||
      !response.body
    ) {
      cancel(response);
      return null;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await bounded(reader.read(), signal);
        if (part.done) break;
        size += part.value.byteLength;
        if (size > limit) throw new OfficialPhotoError("image-too-large");
        chunks.push(part.value);
      }
    } catch (error) {
      void reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
    return size
      ? { buffer: Buffer.concat(chunks, size), contentType, url: url.href }
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
