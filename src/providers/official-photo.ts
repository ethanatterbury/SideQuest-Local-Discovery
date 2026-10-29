import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import type { PhotoQuery, PlacePhoto } from "./place-photo";

/** This adapter runs on the server. Website images retain their owner's rights. */
export type OfficialPhotoQuery = PhotoQuery;
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
  matchedCoordinates?: boolean;
  multiBranch: boolean;
  branchSpecific: boolean;
  evidence: string[];
}
/** Unapproved, branch-vetted inputs for opt-in offline image review only. */
export interface OfficialPhotoReviewCandidate {
  url: string;
  source: string;
  kind: string;
  width?: number;
  height?: number;
  identityEvidence: string[];
  photoScore: number;
  subjectEvidence: string[];
  reason: "unconfirmed-photo-subject" | "unconfirmed-venue-scene";
}
export interface OfficialPhotoParseResult {
  candidates: OfficialPhotoCandidate[];
  reviewCandidates?: OfficialPhotoReviewCandidate[];
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
  /** Restrict extraction to publisher-selected OG/Twitter images. */
  socialPreviewOnly?: boolean;
  /** Runtime external previews also allow explicitly identified physical venue scenes. */
  websitePreview?: boolean;
  /** Offline preparation only; unknown subjects stay unapproved pending image review. */
  collectReviewCandidates?: boolean;
  refresh?: boolean;
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
  return decode(value.replace(/<(?:(?:"[^"]*"|'[^']*')|[^<>"'])*>/g, " "))
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
  let cursor = 0;
  while (cursor < tag.length) {
    while (cursor < tag.length && /[\s=<>/]/.test(tag[cursor])) cursor++;
    const start = cursor;
    while (cursor < tag.length && !/[\s=<>/]/.test(tag[cursor])) cursor++;
    const name = tag.slice(start, cursor);
    while (cursor < tag.length && /\s/.test(tag[cursor])) cursor++;
    if (tag[cursor] !== "=") continue;
    cursor++;
    while (cursor < tag.length && /\s/.test(tag[cursor])) cursor++;
    const quote = tag[cursor];
    let value: string;
    if (quote === '"' || quote === "'") {
      const end = tag.indexOf(quote, cursor + 1);
      if (end < 0) break;
      value = tag.slice(cursor + 1, end);
      cursor = end + 1;
    } else {
      const valueStart = cursor;
      while (cursor < tag.length && !/[\s>]/.test(tag[cursor])) cursor++;
      value = tag.slice(valueStart, cursor);
    }
    if (name && name.length <= 128 && !/["']/.test(name))
      result[name.toLowerCase()] = decode(value);
  }
  return result;
}

type HtmlSpan = {
  name: string;
  start: number;
  end: number;
  attributes: string;
  content: string;
  closed: boolean;
};
/** Each consumed element advances past its closing tag; missing closers scan once. */
function pairedElements(html: string, names: string[]): HtmlSpan[] {
  const opening = new RegExp(
    `<(${names.join("|")})\\b((?:"[^"]*"|'[^']*'|[^<>"'])*)>`,
    "gi",
  );
  const lower = html.toLowerCase();
  const elements: HtmlSpan[] = [];
  for (let match; (match = opening.exec(html));) {
    const name = match[1].toLowerCase();
    const closing = `</${name}>`;
    const endStart = lower.indexOf(closing, opening.lastIndex);
    const closed = endStart >= 0;
    const end = closed ? endStart + closing.length : html.length;
    elements.push({
      name,
      start: match.index,
      end,
      attributes: match[2],
      content: html.slice(opening.lastIndex, closed ? endStart : html.length),
      closed,
    });
    opening.lastIndex = end;
    if (!closed) break;
  }
  return elements;
}
function maskElements(html: string, elements: HtmlSpan[]): string {
  const chunks: string[] = [];
  let cursor = 0;
  for (const element of elements) {
    chunks.push(
      html.slice(cursor, element.start),
      " ".repeat(element.end - element.start),
    );
    cursor = element.end;
  }
  chunks.push(html.slice(cursor));
  return chunks.join("");
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
  /** Image-owned text only; nearby markup cannot establish branch ownership. */
  ownershipContext?: string;
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
  options: Pick<
    OfficialPhotoOptions,
    "socialPreviewOnly" | "websitePreview" | "collectReviewCandidates"
  > = {},
): OfficialPhotoParseResult {
  html = html.slice(0, HTML_LIMIT);
  const websitePreview = options.websitePreview || options.socialPreviewOnly;
  const rejected: Record<string, number> = {};
  const reject = (reason: string) => {
    rejected[reason] = (rejected[reason] ?? 0) + 1;
  };
  const raw: RawImage[] = [];
  const businesses: Record<string, unknown>[] = [];
  const blocks = pairedElements(html, ["script", "style"]);
  const scripts = blocks.filter((element) => element.name === "script");
  const headings = pairedElements(html, ["title", "h1"])
    .filter((element) => element.closed)
    .map((element) => plain(element.content))
    .join(" ");
  const metas: Record<string, string> = {};
  for (const match of html.matchAll(/<meta\b(?:"[^"]*"|'[^']*'|[^<>"'])*>/gi)) {
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
  const area =
    query.area &&
    !/^(?:nearby|unknown|uk|united kingdom)$/.test(normalized(query.area))
      ? query.area
      : undefined;
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
  for (const script of scripts) {
    if (
      !script.closed ||
      !/application\/ld\+json/i.test(attributes(script.attributes).type ?? "")
    )
      continue;
    try {
      walk(JSON.parse(script.content));
    } catch {
      reject("invalid-schema");
    }
  }
  const pageNamed = names.some((name) => contains(primary, name));
  const matchedBusiness = businesses.filter((business) => {
    if (names.some((name) => contains(String(business.name ?? ""), name)))
      return true;
    // Chains often name their Restaurant schema only after the local branch.
    if (!pageNamed || !area || !contains(String(business.name ?? ""), area))
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
  const scopedBusinesses =
    matchedBusiness.length <= 1
      ? matchedBusiness
      : matchedBusiness.filter((business) => {
          try {
            return (
              typeof business.url === "string" &&
              new URL(business.url, pageUrl).href.replace(/\/$/, "") ===
                pageUrl.replace(/\/$/, "")
            );
          } catch {
            return false;
          }
        });
  const businessText = scopedBusinesses
    .map((business) => JSON.stringify(business.address ?? ""))
    .join(" ");
  const coordinateBusinesses = new Set(
    scopedBusinesses.filter((business) => {
      const geo = object(business.geo);
      const coordinate = (value: unknown) =>
        typeof value === "number" || (typeof value === "string" && value.trim())
          ? Number(value)
          : Number.NaN;
      const lat = coordinate(geo?.latitude),
        lng = coordinate(geo?.longitude);
      if (
        ![lat, lng, query.lat, query.lng].every(Number.isFinite) ||
        Math.abs(lat) > 90 ||
        Math.abs(lng) > 180 ||
        Math.abs(query.lat) > 90 ||
        Math.abs(query.lng) > 180
      )
        return false;
      const toRad = Math.PI / 180;
      const a =
        Math.sin(((lat - query.lat) * toRad) / 2) ** 2 +
        Math.cos(lat * toRad) *
          Math.cos(query.lat * toRad) *
          Math.sin(((lng - query.lng) * toRad) / 2) ** 2;
      return (
        6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a))) <=
        0.15
      );
    }),
  );
  const matchedCoordinates = coordinateBusinesses.size > 0;
  const matchedName =
    names.some((name) => contains(primary, name)) || matchedBusiness.length > 0;
  const matchedArea =
    !!area && (contains(primary, area) || contains(businessText, area));
  const visible = plain(maskElements(html, blocks));
  const multiBranch =
    chainNames.test(normalized(query.name)) ||
    /\b(?:find (?:a|your) (?:store|branch|restaurant|gym)|our (?:locations|branches|restaurants|cinemas)|store locator|location finder|across (?:the )?(?:uk|united kingdom)|nationwide)\b/i.test(
      visible,
    ) ||
    matchedBusiness.length > 1;
  const localIdentityText = `${headings} ${metas["og:title"] ?? ""} ${metas["og:description"] ?? ""} ${metas.description ?? ""} ${businessText}`;
  const matchedAddress =
    (!!query.address && contains(localIdentityText, query.address)) ||
    (!!query.postcode &&
      contains(
        `${localIdentityText} ${multiBranch ? "" : visible}`,
        query.postcode,
      ));
  const branchSpecific =
    matchedName &&
    (!multiBranch || matchedArea || matchedAddress || matchedCoordinates);
  const identity: OfficialPhotoIdentity = {
    matchedName,
    matchedArea,
    matchedAddress,
    ...(matchedCoordinates ? { matchedCoordinates: true } : {}),
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
      ...(matchedCoordinates ? ["venue coordinates matched"] : []),
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
  const withoutScripts = maskElements(html, scripts);
  for (const match of withoutScripts.matchAll(
    /<(?:img|source)\b(?:"[^"]*"|'[^']*'|[^<>"'])*>/gi,
  )) {
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
    const context = `${attr.alt ?? ""} ${attr.title ?? ""} ${attr.class ?? ""} ${attr.id ?? ""} ${websitePreview ? "" : parentContext} ${wordpressGallery ? "WordPress gallery" : ""}`;
    const ownershipContext = `${attr.alt ?? ""} ${attr.title ?? ""} ${attr["aria-label"] ?? ""}`;
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
        raw.push({
          raw: attr[key],
          context,
          ownershipContext,
          kind: "body",
          width,
          height,
        });
    // WordPress galleries expose their originals beside small cropped thumbnails.
    for (const key of ["data-large_image", "data-full-url", "data-orig-file"])
      if (attr[key])
        raw.push({
          raw: attr[key],
          context: `${context} gallery`,
          ownershipContext,
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
        raw.push({
          raw: href,
          context: `${context} gallery`,
          ownershipContext,
          kind: "body",
        });
    }
    for (const key of ["data-srcset", "data-lazy-srcset", "srcset"])
      if (attr[key])
        for (const image of srcset(attr[key]).slice(0, 3))
          raw.push({
            ...image,
            context,
            ownershipContext,
            kind: "body",
            height:
              width && height && image.width
                ? Math.round((height * image.width) / width)
                : height,
          });
  }
  for (const match of withoutScripts.matchAll(
    /<[a-z](?:"[^"]*"|'[^']*'|[^<>"'])*>/gi,
  )) {
    if (
      !/\bdata-(?:background(?:-image)?|bg|bgset|lazy-background)\s*=/i.test(
        match[0],
      )
    )
      continue;
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
  const backgroundAttributes = new Map<number, Record<string, string>>();
  for (const match of withoutScripts.matchAll(
    /(?:background(?:-image)?\s*:)[^;{}<>]{0,500}?url\(\s*(["']?)([^)'"\s]{1,4096})\1\s*\)/gi,
  )) {
    const start = withoutScripts.lastIndexOf("<", match.index);
    const end = withoutScripts.indexOf(">", start);
    let attr = backgroundAttributes.get(start);
    if (!attr) {
      // A stylesheet's text is not the attributes of its <style> element.
      attr =
        start >= 0 && end >= match.index!
          ? attributes(withoutScripts.slice(start, end + 1))
          : {};
      backgroundAttributes.set(start, attr);
    }
    const context = `${attr.class ?? ""} ${attr.id ?? ""} ${attr.title ?? ""} ${attr["aria-label"] ?? ""}`;
    raw.push({ raw: match[2], kind: "background", context });
  }
  // Wix/Squarespace hydration often contains originals absent from <img src>.
  // JSON-LD images were already extracted with their owning business attached.
  const hydrationHtml = maskElements(
    html,
    scripts.filter((script) =>
      /application\/ld\+json/i.test(attributes(script.attributes).type ?? ""),
    ),
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

  // Explicit finer-grained location contradictions override a matching town/name.
  const postcodeKey = (value: string) => value.toUpperCase().replace(/\s/g, "");
  const conflictingLocation = scopedBusinesses.some((business) => {
    const address = object(business.address);
    const postcode = address?.postalCode;
    if (
      query.postcode &&
      typeof postcode === "string" &&
      postcodeKey(postcode) !== postcodeKey(query.postcode)
    )
      return true;
    const geo = object(business.geo);
    const lat = Number(geo?.latitude),
      lng = Number(geo?.longitude);
    if (
      geo &&
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180
    ) {
      const toRad = Math.PI / 180;
      const dLat = (lat - query.lat) * toRad;
      const dLng = (lng - query.lng) * toRad;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat * toRad) *
          Math.cos(query.lat * toRad) *
          Math.sin(dLng / 2) ** 2;
      return (
        6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a))) > 0.5
      );
    }
    return false;
  });
  if (
    (websitePreview || options.collectReviewCandidates) &&
    conflictingLocation
  ) {
    reject("conflicting-preview-location");
    return {
      candidates: [],
      identity,
      rejected,
      ...(options.collectReviewCandidates ? { reviewCandidates: [] } : {}),
    };
  }
  const photos = new Map<string, OfficialPhotoCandidate>();
  const review = new Map<
    string,
    { candidate: OfficialPhotoReviewCandidate; rank: number }
  >();
  // Build ownership evidence once, including contradictions outside the selected
  // candidate window. Cache URL parsing instead of repeating it per candidate.
  const imageUrls = new Map<string, string | null>();
  const urlFor = (value: string) => {
    if (!imageUrls.has(value)) imageUrls.set(value, imageUrl(value, pageUrl));
    return imageUrls.get(value)!;
  };
  const bodyContexts = new Map<string, string[]>();
  for (const item of raw) {
    if (item.kind !== "body") continue;
    const url = urlFor(item.raw);
    if (url) {
      let contexts = bodyContexts.get(url);
      if (!contexts) bodyContexts.set(url, (contexts = []));
      contexts.push(item.context);
    }
  }
  const bodyUrls = new Set(
    raw
      .filter((item) => item.kind === "body" || item.kind === "background")
      .map((item) => urlFor(item.raw))
      .filter(Boolean),
  );
  const otherBusinessUrls = new Set(
    raw
      .filter(
        (item) => item.business && !scopedBusinesses.includes(item.business),
      )
      .map((item) => urlFor(item.raw))
      .filter(Boolean),
  );
  const imageLocationMatched = (text: string) =>
    [area, query.address, query.postcode].some(
      (location) => !!location && contains(text, location),
    );
  // A local page can still publish shared brand campaigns and sibling branches.
  // Keep opaque filenames when the exact image belongs to an explicitly local business.
  const localBusinessUrls = new Set(
    raw
      .filter(
        (item) =>
          item.business &&
          scopedBusinesses.includes(item.business) &&
          (coordinateBusinesses.has(item.business) ||
            imageLocationMatched(
              `${item.business.name ?? ""} ${JSON.stringify(item.business.address ?? "")} ${item.business.url ?? ""}`,
            )),
      )
      .map((item) => urlFor(item.raw))
      .filter(Boolean),
  );
  const ownedImageText = new Map<string, string>();
  for (const item of raw) {
    // Hydration windows and Organization schema have no reliable image-level owner.
    if (["gallery-data", "schema"].includes(item.kind)) continue;
    const url = urlFor(item.raw);
    if (url)
      ownedImageText.set(
        url,
        `${ownedImageText.get(url) ?? ""} ${item.ownershipContext ?? item.context}`,
      );
  }
  const localContent = `${headings} ${metas["og:title"] ?? ""} ${metas["og:description"] ?? ""} ${metas.description ?? ""} ${businessText}`;
  const locationMatched =
    matchedAddress ||
    matchedCoordinates ||
    !!(area && contains(`${localContent} ${multiBranch ? "" : visible}`, area));
  for (const item of raw.slice(0, 1200)) {
    if (websitePreview && ["gallery-data", "schema"].includes(item.kind)) {
      // Nearby hydration captions and Organization art have no image-specific venue ownership.
      reject("unscoped-image-context");
      continue;
    }
    if (
      options.socialPreviewOnly &&
      !["open-graph", "twitter"].includes(item.kind)
    )
      continue;
    // Multi-branch footers and URL paths cannot prove the image's local branch.
    if (websitePreview && !locationMatched) {
      reject("unconfirmed-preview-location");
      continue;
    }
    const url = urlFor(item.raw);
    if (!url) {
      reject("unsafe-or-unsupported-image");
      continue;
    }
    if ((websitePreview || multiBranch) && otherBusinessUrls.has(url)) {
      reject("different-schema-venue");
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
    const imageBranchMatched =
      localBusinessUrls.has(url) ||
      imageLocationMatched(`${filename} ${ownedImageText.get(url) ?? ""}`);
    if (multiBranch && !imageBranchMatched) {
      reject("unconfirmed-image-branch");
      continue;
    }
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
    if (
      item.business &&
      !(websitePreview ? scopedBusinesses : matchedBusiness).includes(
        item.business,
      )
    ) {
      reject("different-schema-venue");
      continue;
    }
    const schemaVenue = item.kind === "schema-venue" && !!item.business;
    const onPage = bodyUrls.has(url);
    const assessment = assessOfficialPhotoSubject(
      {
        url,
        // Some publishers omit og:image:alt but caption that exact image in the body.
        // Never borrow a description from a different image on the same page.
        context: websitePreview
          ? [item.context, ...(bodyContexts.get(url) ?? [])].join(" ")
          : item.context,
        kind: item.kind,
        width: item.width,
        height: item.height,
      },
      query,
    );
    const identityEvidence = [
      ...identity.evidence,
      ...(multiBranch && imageBranchMatched
        ? ["image attributed to the local branch"]
        : []),
    ];
    const collectForReview = (
      reason: OfficialPhotoReviewCandidate["reason"],
    ) => {
      if (!options.collectReviewCandidates || !locationMatched) return;
      const image = new URL(url);
      const knownImageEndpoint =
        [
          "images.ctfassets.net",
          "imagedelivery.net",
          "res.cloudinary.com",
        ].includes(image.hostname) && !/\.[^/]+$/.test(image.pathname);
      if (
        !/\.(?:jpe?g|png|webp|avif)$/i.test(image.pathname) &&
        !knownImageEndpoint
      )
        return;
      const rank =
        (["open-graph", "twitter"].includes(item.kind) ? 100 : 0) +
        (/\bhero\b/i.test(item.context) ? 80 : 0) +
        (onPage ? 20 : 0) +
        Math.min(30, (item.width ?? 0) / 100);
      const previous = review.get(url);
      if (!previous || rank > previous.rank)
        review.set(url, {
          rank,
          candidate: {
            url,
            source: pageUrl,
            kind: item.kind,
            width: item.width,
            height: item.height,
            identityEvidence,
            photoScore: assessment.photoScore,
            subjectEvidence: assessment.subjectEvidence,
            reason,
          },
        });
    };
    if (!assessment.accepted) {
      if (assessment.rejection === "unconfirmed-photo-subject")
        collectForReview("unconfirmed-photo-subject");
      reject(assessment.rejection ?? "unconfirmed-photo-subject");
      continue;
    }
    if (
      websitePreview &&
      !["open-graph", "twitter"].includes(item.kind) &&
      assessment.photoScore < 75
    ) {
      // A 'gallery' class alone cannot establish a physical scene rather than food/artwork.
      collectForReview("unconfirmed-venue-scene");
      reject("unconfirmed-venue-scene");
      continue;
    }
    const rank =
      assessment.photoScore * 10 +
      (schemaVenue ? 5 : 0) +
      (onPage ? 8 : 0) +
      (["open-graph", "twitter"].includes(item.kind)
        ? websitePreview
          ? 20
          : 3
        : 0) +
      (matchedArea || matchedAddress ? 5 : 0) +
      Math.min(5, (item.width ?? 800) / 400);
    const evidence = [
      item.kind,
      ...identityEvidence,
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
      ...(websitePreview
        ? {
            preview: {
              kind: ["open-graph", "twitter"].includes(item.kind)
                ? (item.kind as "open-graph" | "twitter")
                : "venue-image",
              pageUrl,
              publisher: query.name,
              identityEvidence,
              subjectEvidence: assessment.subjectEvidence,
            },
          }
        : {}),
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
    ...(options.collectReviewCandidates
      ? {
          reviewCandidates: [...review.values()]
            .filter(({ candidate }) => !photos.has(candidate.url))
            .sort((a, b) => b.rank - a.rank)
            .slice(0, 8)
            .map(({ candidate }) => candidate),
        }
      : {}),
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

async function readOfficialWebsitePage(
  websiteValue: string,
  options: OfficialPhotoOptions,
  signal: AbortSignal,
  lookup: OfficialPhotoLookup,
  onRequest: () => void,
): Promise<{ html: string; pageUrl: string }> {
  if (!websiteValue) throw new OfficialPhotoError("missing-website");
  // Historic OSM websites often use http; request only their HTTPS endpoint.
  const website = websiteValue.replace(/^http:\/\//i, "https://");
  if (!safeOfficialPhotoUrl(website))
    throw new OfficialPhotoError("unsafe-url");
  let url = new URL(website);
  url.hash = "";
  let response: Response;
  for (let redirects = 0; ; redirects++) {
    const addresses = await publicAddresses(url, lookup, signal);
    onRequest();
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
  const pageUrl = url.href;
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
  return { html: await readHtml(response, signal), pageUrl };
}

/** Bounded server-only HTML reader shared by official venue evidence adapters. */
export async function readOfficialWebsite(
  website: string,
  options: OfficialPhotoOptions = {},
): Promise<{ html: string; pageUrl: string; requestCount: number }> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(
    onAbort,
    Math.min(30_000, Math.max(1, options.timeoutMs ?? 2500)),
  );
  let requestCount = 0;
  try {
    const page = await readOfficialWebsitePage(
      website,
      options,
      controller.signal,
      options.lookup ??
        ((host) => dnsLookup(host, { all: true, verbatim: true })),
      () => requestCount++,
    );
    return { ...page, requestCount };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
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
    ...(options.collectReviewCandidates ? { reviewCandidates: [] } : {}),
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
    const page = await readOfficialWebsitePage(
      query.website ?? "",
      options,
      signal,
      lookup,
      () => requestCount++,
    );
    pageUrl = page.pageUrl;
    const parsed = parseOfficialPhotoHtml(page.html, pageUrl, query, options);
    // Check public DNS for candidate CDNs too; no arbitrary private image URLs escape.
    const verified: OfficialPhotoCandidate[] = [];
    const guards = new Map<string, Promise<boolean>>();
    const guardImage = async (candidate: { url: string }) => {
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
      const allowed = await guard;
      if (!allowed)
        parsed.rejected["unsafe-image-dns"] =
          (parsed.rejected["unsafe-image-dns"] ?? 0) + 1;
      return allowed;
    };
    const max = Math.min(MAX_IMAGES, Math.max(1, options.maxCandidates ?? 12));
    for (const candidate of parsed.candidates.slice(0, Math.max(max * 3, 24))) {
      if (await guardImage(candidate)) verified.push(candidate);
      if (verified.length >= max) break;
    }
    const verifiedReview: OfficialPhotoReviewCandidate[] = [];
    for (const candidate of parsed.reviewCandidates ?? [])
      if (await guardImage(candidate)) verifiedReview.push(candidate);
    return {
      ...parsed,
      candidates: verified,
      ...(options.collectReviewCandidates
        ? { reviewCandidates: verifiedReview }
        : {}),
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

/** An externally hosted link preview is not a reusable or permissioned photograph. */
async function resolveWebsitePreview(
  query: OfficialPhotoQuery,
  options: OfficialPhotoOptions = {},
): Promise<{
  image: PlacePhoto | null;
  retryable: boolean;
  result: OfficialPhotoResult;
}> {
  const result = await resolveOfficialPhotos(query, {
    ...options,
    websitePreview: true,
    maxCandidates: 1,
  });
  const candidate = result.candidates[0];
  const image: PlacePhoto | null = candidate?.preview
    ? {
        url: candidate.url,
        source: candidate.source,
        credit: query.name,
        license: "Website preview — rights reserved",
        rights: "website-preview",
        strategy: "official-website-preview",
        checkedAt: new Date().toISOString(),
        width: candidate.width,
        height: candidate.height,
        confidence: candidate.confidence,
        matched: candidate.matched,
        preview: candidate.preview,
      }
    : null;
  return { image, retryable: result.retryable, result };
}

type WebsitePreviewResult = Awaited<ReturnType<typeof resolveWebsitePreview>>;
// Metadata only: source HTML and image bytes never enter this cache.
const websitePreviewCache = new Map<
  string,
  { until: number; result: WebsitePreviewResult }
>();
const pendingWebsitePreviews = new Map<string, Promise<WebsitePreviewResult>>();
export async function resolveOfficialWebsitePreview(
  query: OfficialPhotoQuery,
  options: OfficialPhotoOptions = {},
): Promise<WebsitePreviewResult> {
  // Injected transports remain isolated and deterministic for importers/tests.
  if (options.fetch || options.lookup || options.collectReviewCandidates)
    return resolveWebsitePreview(query, options);
  const key = JSON.stringify([
    query.name,
    query.lat,
    query.lng,
    query.area,
    query.address,
    query.postcode,
    query.website,
    query.aliases,
  ]);
  const cached = websitePreviewCache.get(key);
  if (!options.refresh && cached && cached.until > Date.now())
    return structuredClone(cached.result);
  const pending = pendingWebsitePreviews.get(key);
  if (pending) return structuredClone(await pending);
  if (pendingWebsitePreviews.size >= 3)
    return resolveWebsitePreview(query, {
      ...options,
      signal: AbortSignal.abort(),
    });
  const task = resolveWebsitePreview(query, options)
    .then((result) => {
      websitePreviewCache.set(key, {
        result,
        until:
          Date.now() +
          (result.image ? 6 * 3600000 : result.retryable ? 30000 : 3600000),
      });
      if (websitePreviewCache.size > 300)
        websitePreviewCache.delete(websitePreviewCache.keys().next().value!);
      return result;
    })
    .finally(() => {
      pendingWebsitePreviews.delete(key);
    });
  pendingWebsitePreviews.set(key, task);
  return structuredClone(await task);
}
