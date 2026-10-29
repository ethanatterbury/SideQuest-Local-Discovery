import type { PlacePhoto } from "./place-photo";
import { openPhotoLicense } from "./photo-policy";

const ENDPOINT = "https://commons.wikimedia.org/w/api.php";
const MAX_BODY_BYTES = 512 * 1024;
const MAX_CANDIDATES = 6;
const USER_AGENT =
  "SideQuest/1.0 (https://sidequest-local-discovery.vercel.app; contact https://github.com/ethanatterbury/SideQuest-Local-Discovery/issues)";

type Metadata = Record<string, { value?: string }>;
type CommonsPage = {
  pageid?: number;
  ns?: number;
  title?: string;
  imageinfo?: {
    url?: string;
    thumburl?: string;
    descriptionurl?: string;
    width?: number;
    height?: number;
    thumbwidth?: number;
    thumbheight?: number;
    mime?: string;
    extmetadata?: Metadata;
  }[];
};
type Json = Record<string, unknown>;
export type GeographCommonsEvidence = {
  geographId: string;
  candidateCount: number;
  lookup?: "structured-id" | "source-url";
  commonsPageId?: number;
  commonsTitle?: string;
  sourceUrl?: string;
  structuredIds?: string[];
  description?: string;
  photographer?: string;
  warnings: string[];
};
export type GeographCommonsResult = {
  /** A source-identified candidate; venue identity and visual quality still need review. */
  image: PlacePhoto | null;
  reason: string;
  retryable: boolean;
  requestCount: number;
  retryAfterMs?: number;
  evidence: GeographCommonsEvidence;
};
export type GeographCommonsOptions = {
  fetch?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  checkedAt?: string;
  expectedTitle?: string;
  expectedPhotographer?: string;
};

class LookupError extends Error {
  constructor(
    readonly reason: string,
    readonly retryable = false,
    readonly retryAfterMs?: number,
  ) {
    super(reason);
  }
}

function record(value: unknown): Json | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : undefined;
}
function decodeEntities(value: string): string {
  return value.replace(
    /&(?:amp|quot|apos|lt|gt|nbsp|#\d+|#x[\da-f]+);/gi,
    (entity) => {
      const named: Record<string, string> = {
        "&amp;": "&",
        "&quot;": '"',
        "&apos;": "'",
        "&lt;": "<",
        "&gt;": ">",
        "&nbsp;": " ",
      };
      if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
      const numeric = entity.slice(2, -1);
      const code =
        numeric[0]?.toLowerCase() === "x"
          ? Number.parseInt(numeric.slice(1), 16)
          : Number(numeric);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : "";
    },
  );
}
function plain(value = ""): string {
  return decodeEntities(
    value
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<[^>]*>/g, ""),
  )
    .replace(/<[^>]*>/g, "")
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
}
function geographId(value: unknown): string | undefined {
  const text = typeof value === "number" ? String(value) : value;
  return typeof text === "string" &&
    /^[1-9]\d{0,15}$/.test(text) &&
    Number.isSafeInteger(Number(text))
    ? text
    : undefined;
}
function sourceId(value: string): string | undefined {
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value);
    if (
      !/^https?:$/.test(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      !["geograph.org.uk", "www.geograph.org.uk"].includes(url.hostname)
    )
      return;
    return geographId(/^\/photo\/([1-9]\d*)\/?$/.exec(url.pathname)?.[1]);
  } catch {
    return;
  }
}
function sourceIds(metadata: Metadata): string[] {
  const ids = new Set<string>();
  for (const key of [
    "Credit",
    "ImageDescription",
    "Source",
    "SourceUrl",
    "Attribution",
  ]) {
    const value = metadata[key]?.value;
    if (typeof value !== "string") continue;
    for (const match of decodeEntities(value).matchAll(
      /(?:https?:)?\/\/[^\s"'<>]+/gi,
    )) {
      const id = sourceId(match[0]);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}
function cdnUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !value.startsWith("https://upload.wikimedia.org/")
  )
    return false;
  try {
    const url = new URL(value);
    return (
      url.hostname === "upload.wikimedia.org" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      url.pathname.startsWith("/wikipedia/commons/") &&
      /\.(?:jpe?g|png|webp|avif)$/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}
function descriptionUrl(value: unknown, title: string): value is string {
  if (
    typeof value !== "string" ||
    !value.startsWith("https://commons.wikimedia.org/")
  )
    return false;
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      url.pathname.startsWith("/wiki/File:") &&
      decodeURIComponent(url.pathname.slice(6)).replaceAll("_", " ") ===
        title.replaceAll("_", " ")
    );
  } catch {
    return false;
  }
}
function pages(data: Json): CommonsPage[] {
  const value = record(data.query)?.pages;
  return (
    Array.isArray(value) ? value : Object.values(record(value) || {})
  ).filter((page): page is CommonsPage => !!record(page));
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new LookupError("deadline-exceeded", true));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
async function jsonBody(
  response: Response,
  signal: AbortSignal,
): Promise<Json> {
  if (
    !/^application\/(?:[\w.+-]+\+)?json\b/i.test(
      response.headers.get("content-type") || "",
    )
  )
    throw new LookupError("invalid-content-type");
  const length = response.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    void response.body?.cancel().catch(() => {});
    throw new LookupError("response-too-large");
  }
  if (!response.body) throw new LookupError("invalid-json");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await abortable(reader.read(), signal);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BODY_BYTES) throw new LookupError("response-too-large");
      chunks.push(chunk.value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const data = record(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    if (!data) throw new Error();
    return data;
  } catch {
    throw new LookupError("invalid-json");
  }
}

/** Resolve Commons mirrors by source identity, never by filename or a Geograph image hotlink. */
export async function resolveGeographCommonsPhoto(
  id: number | string,
  options: GeographCommonsOptions = {},
): Promise<GeographCommonsResult> {
  const normalizedId = geographId(id);
  const evidence: GeographCommonsEvidence = {
    geographId: normalizedId || "",
    candidateCount: 0,
    warnings: [],
  };
  let requestCount = 0;
  const result = (
    reason: string,
    image: PlacePhoto | null = null,
    retryable = false,
    retryAfterMs?: number,
  ): GeographCommonsResult => ({
    image,
    reason,
    retryable,
    requestCount,
    evidence,
    ...(retryAfterMs ? { retryAfterMs } : {}),
  });
  if (!normalizedId) return result("invalid-geograph-id");
  const checkedAt = options.checkedAt || new Date().toISOString();
  if (!Number.isFinite(Date.parse(checkedAt)))
    return result("invalid-checked-at");
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timeout = Number.isFinite(options.timeoutMs)
    ? Math.max(1, Math.min(15000, options.timeoutMs!))
    : 6500;
  const timer = setTimeout(abort, timeout);
  const request = async (params: Record<string, string>): Promise<Json> => {
    if (controller.signal.aborted)
      throw new LookupError("deadline-exceeded", true);
    if (requestCount >= 7) throw new LookupError("request-limit", true);
    const query = new URLSearchParams({
      format: "json",
      formatversion: "2",
      maxlag: "5",
      ...params,
    });
    requestCount++;
    const response = await abortable(
      (options.fetch || fetch)(`${ENDPOINT}?${query}`, {
        signal: controller.signal,
        redirect: "error",
        cache: "no-store",
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      }),
      controller.signal,
    );
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      const seconds = Number(response.headers.get("retry-after"));
      throw new LookupError(
        `http-${response.status}`,
        response.status === 429 || response.status >= 500,
        Number.isFinite(seconds) && seconds > 0
          ? Math.min(seconds * 1000, 300000)
          : undefined,
      );
    }
    const data = await jsonBody(response, controller.signal);
    const error = record(data.error);
    if (error) {
      const code =
        typeof error.code === "string" && /^[\w-]{1,60}$/.test(error.code)
          ? error.code
          : "unknown";
      throw new LookupError(
        `api-${code}`,
        ["maxlag", "ratelimited", "readonly", "timeout"].includes(code),
      );
    }
    return data;
  };
  const mediaParams = {
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: "960",
    iiextmetadatalanguage: "en",
  };
  const evaluate = async (
    candidates: CommonsPage[],
    lookup: "structured-id" | "source-url",
  ): Promise<GeographCommonsResult> => {
    evidence.lookup = lookup;
    evidence.candidateCount = candidates.length;
    if (!candidates.length) return result("not-found");
    if (candidates.length > MAX_CANDIDATES)
      return result("ambiguous-candidates");
    const eligible = candidates.filter(
      (page) =>
        Number.isSafeInteger(page.pageid) &&
        page.pageid! > 0 &&
        page.ns === 6 &&
        page.title?.startsWith("File:"),
    );
    if (!eligible.length) return result("invalid-commons-page");
    const data = await request({
      action: "wbgetentities",
      ids: eligible.map((page) => `M${page.pageid}`).join("|"),
      props: "claims",
    });
    const entities = record(data.entities) || {};
    const accepted: {
      image: PlacePhoto;
      page: CommonsPage;
      ids: string[];
      description: string;
    }[] = [];
    let reason = "missing-source-evidence";
    for (const page of eligible) {
      const entity = record(entities[`M${page.pageid}`]);
      // Missing MediaInfo is normal for older files; a malformed response is not absence of claims.
      if (!entity) {
        reason = "missing-mediainfo";
        continue;
      }
      const ids: string[] = [];
      const containers = [entity.claims, entity.statements].filter(
        (value) => value !== undefined,
      );
      let invalidClaim = containers.some((value) => !record(value));
      for (const container of containers) {
        const rawClaims = record(container)?.P7384;
        if (rawClaims !== undefined && !Array.isArray(rawClaims)) {
          invalidClaim = true;
          continue;
        }
        for (const rawClaim of Array.isArray(rawClaims) ? rawClaims : []) {
          const claim = record(rawClaim);
          if (claim?.rank === "deprecated") continue;
          const value = record(record(claim?.mainsnak)?.datavalue)?.value;
          const claimId = geographId(value);
          if (!claimId) invalidClaim = true;
          else ids.push(claimId);
        }
      }
      if (
        invalidClaim ||
        ids.some((value) => value !== normalizedId) ||
        (lookup === "structured-id" && !ids.length)
      ) {
        reason = "conflicting-structured-id";
        continue;
      }
      const info = page.imageinfo?.[0];
      const metadata = info?.extmetadata || {};
      const sources = sourceIds(metadata);
      if (sources.length !== 1 || sources[0] !== normalizedId) {
        reason = sources.length
          ? "conflicting-source-id"
          : "missing-source-evidence";
        continue;
      }
      if (
        !info ||
        !cdnUrl(info.url) ||
        (info.thumburl !== undefined && !cdnUrl(info.thumburl)) ||
        !descriptionUrl(info.descriptionurl, page.title!) ||
        !/^image\/(?:jpeg|png|webp|avif)$/.test(info.mime || "")
      ) {
        reason = "unsafe-image-url";
        continue;
      }
      const credit = plain(metadata.Artist?.value).slice(0, 300);
      const license = plain(metadata.LicenseShortName?.value);
      if (!credit) {
        reason = "missing-credit";
        continue;
      }
      if (!openPhotoLicense(license)) {
        reason = "non-open-license";
        continue;
      }
      const description = plain(metadata.ImageDescription?.value);
      const width = info.thumburl ? info.thumbwidth : info.width;
      const height = info.thumburl ? info.thumbheight : info.height;
      accepted.push({
        page,
        ids: [...new Set(ids)],
        description,
        image: {
          url: info.thumburl || info.url,
          source: info.descriptionurl,
          credit,
          license,
          rights: "open",
          checkedAt,
          strategy: "geograph-commons-source-id",
          matched: [
            "exact-geograph-source-id",
            ...(ids.length ? ["structured-geograph-id"] : []),
          ],
          ...(Number.isFinite(width) && width! > 0 ? { width } : {}),
          ...(Number.isFinite(height) && height! > 0 ? { height } : {}),
        },
      });
    }
    if (accepted.length > 1) return result("ambiguous-candidates");
    if (!accepted.length) return result(reason);
    const candidate = accepted[0];
    Object.assign(evidence, {
      commonsPageId: candidate.page.pageid,
      commonsTitle: candidate.page.title,
      sourceUrl: `https://www.geograph.org.uk/photo/${normalizedId}`,
      structuredIds: candidate.ids,
      description: candidate.description,
      photographer: candidate.image.credit,
    });
    // Bulk text is advisory: initials, aliases and renamed titles must not break an exact source binding.
    const words = (value: string): string[] =>
      value
        .normalize("NFKD")
        .toLowerCase()
        .match(/[\p{L}\p{N}]{3,}/gu) || [];
    for (const [expected, actual, label] of [
      [
        options.expectedTitle,
        `${candidate.page.title} ${candidate.description}`,
        "bulk-title-needs-review",
      ],
      [
        options.expectedPhotographer,
        candidate.image.credit,
        "bulk-photographer-needs-review",
      ],
    ])
      if (
        expected &&
        !words(expected).some((word) => words(actual!).includes(word))
      )
        evidence.warnings.push(label!);
    return result("matched", candidate.image);
  };
  try {
    const search = await request({
      action: "query",
      generator: "search",
      gsrsearch: `haswbstatement:P7384=${normalizedId}`,
      gsrnamespace: "6",
      gsrlimit: String(MAX_CANDIDATES),
      ...mediaParams,
    });
    if (search.continue) return result("ambiguous-candidates");
    const primary = await evaluate(pages(search), "structured-id");
    if (primary.image || primary.reason === "ambiguous-candidates")
      return primary;
    // exturlusage is a prefix index: filter the returned URL by its complete numeric path.
    const found = new Map<number, string>();
    let continuation: Record<string, string> = {};
    for (let batch = 0; batch < 2; batch++) {
      const links = await request({
        action: "query",
        list: "exturlusage",
        euquery: `www.geograph.org.uk/photo/${normalizedId}`,
        eunamespace: "6",
        euprop: "ids|title|url",
        eulimit: "50",
        ...continuation,
      });
      const usage = record(links.query)?.exturlusage;
      if (!Array.isArray(usage)) throw new LookupError("invalid-api-response");
      for (const raw of usage) {
        const link = record(raw);
        if (
          link &&
          typeof link.url === "string" &&
          sourceId(link.url) === normalizedId &&
          Number.isSafeInteger(link.pageid) &&
          Number(link.pageid) > 0 &&
          link.ns === 6 &&
          typeof link.title === "string" &&
          link.title.startsWith("File:")
        )
          found.set(Number(link.pageid), link.title);
      }
      if (found.size > MAX_CANDIDATES) return result("ambiguous-candidates");
      const next = record(links.continue);
      if (!next) break;
      if (batch === 1) return result("lookup-incomplete", null, true);
      continuation = {};
      for (const key of ["continue", "eucontinue"])
        if (typeof next[key] === "string" && next[key].length <= 500)
          continuation[key] = next[key];
      if (!continuation.eucontinue)
        throw new LookupError("invalid-continuation");
    }
    if (!found.size)
      return primary.reason === "not-found" ? result("not-found") : primary;
    const files = await request({
      action: "query",
      pageids: [...found.keys()].join("|"),
      ...mediaParams,
    });
    const candidates = pages(files).filter((page) =>
      found.has(page.pageid || 0),
    );
    return await evaluate(candidates, "source-url");
  } catch (error) {
    return error instanceof LookupError
      ? result(error.reason, null, error.retryable, error.retryAfterMs)
      : result(
          controller.signal.aborted ? "deadline-exceeded" : "network-error",
          null,
          true,
        );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
