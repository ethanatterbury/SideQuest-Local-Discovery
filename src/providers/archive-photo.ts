import type { PlacePhoto } from "./place-photo";

/** Exact OSM image bindings only; never searches Archive albums for a subject. */
export interface ArchivePhotoOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  fetch?: typeof fetch;
}
export interface ArchivePhotoResult {
  image: PlacePhoto | null;
  reason: string | null;
  retryable: boolean;
  requestCount: number;
  diagnostics: {
    rejected: Record<string, number>;
    requestCount: number;
    elapsedMs: number;
  };
}
type Reference = {
  identifier: string;
  file: string;
  download: string;
  source: string;
};
const HEADER_LIMIT = 128 * 1024;
const METADATA_LIMIT = 1024 * 1024;
const MAX_REDIRECTS = 3;

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
function decodeSegments(path: string): string[] | null {
  try {
    const parts = path.split("/").map(decodeURIComponent);
    if (
      parts.some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /[%\\/\x00-\x1f\x7f]/.test(part),
      )
    )
      return null;
    return parts;
  } catch {
    return null;
  }
}
export function parseArchivePhotoUrl(
  value: string | undefined,
): Reference | null {
  // Validate the original path before URL() can normalize encoded dot segments.
  if (!value || value.length > 2048 || /[\s\\?#]/.test(value)) return null;
  const match = /^https:\/\/archive\.org\/(?:details|download)\/(.+)$/.exec(
    value,
  );
  if (!match) return null;
  const parts = decodeSegments(match[1]);
  if (
    !parts ||
    parts.length < 2 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(parts[0])
  )
    return null;
  const identifier = parts.shift()!;
  const file = parts.join("/");
  if (file.length > 1024 || !/\.jpe?g$/i.test(file)) return null;
  const path = `${encodeURIComponent(identifier)}/${encodePath(file)}`;
  return {
    identifier,
    file,
    download: `https://archive.org/download/${path}`,
    source: `https://archive.org/details/${path}`,
  };
}
export function safeArchivePhotoUrl(
  value: string | undefined,
  description = false,
): boolean {
  const reference = parseArchivePhotoUrl(value);
  return (
    !!reference &&
    value === (description ? reference.source : reference.download)
  );
}
class Rejection extends Error {
  constructor(
    public reason: string,
    public retryable = false,
  ) {
    super(reason);
  }
}
function cancel(response: Response): void {
  if (response.body) void response.body.cancel().catch(() => {});
}
/** Race every operation, including body reads, because fetch mocks/transports may ignore abort. */
function bounded<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted)
    return Promise.reject(new Rejection("timeout-or-abort", true));
  return new Promise((resolve, reject) => {
    const aborted = () => {
      reject(new Rejection("timeout-or-abort", true));
    };
    signal.addEventListener("abort", aborted, { once: true });
    operation
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", aborted));
  });
}
async function readBytes(
  response: Response,
  limit: number,
  signal: AbortSignal,
  prefix = false,
): Promise<Uint8Array> {
  if (!response.body) throw new Rejection("empty-body");
  const declared = Number(response.headers.get("content-length"));
  if (!prefix && Number.isFinite(declared) && declared > limit) {
    cancel(response);
    throw new Rejection("metadata-too-large");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let reads = 0;
  try {
    while (length < limit) {
      if (++reads > 4096) throw new Rejection("fragmented-body");
      const { done, value } = await bounded(reader.read(), signal);
      if (done) break;
      if (!value.byteLength) throw new Rejection("empty-body-chunk");
      if (!prefix && length + value.byteLength > limit)
        throw new Rejection("metadata-too-large");
      const chunk = value.subarray(0, limit - length);
      chunks.push(chunk);
      length += chunk.byteLength;
    }
    if (!prefix && length === limit) {
      const next = await bounded(reader.read(), signal);
      if (!next.done) throw new Rejection("metadata-too-large");
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
function trustedDownload(value: string, reference: Reference): boolean {
  if (value === reference.download) return true;
  if (value.length > 2048 || /[\s\\?#]/.test(value)) return false;
  const match =
    /^https:\/\/(?:dn|ia)\d{5,8}\.(?:ca|us)\.archive\.org\/\d\/items\/(.+)$/.exec(
      value,
    );
  const parts = match && decodeSegments(match[1]);
  return (
    !!parts &&
    parts[0] === reference.identifier &&
    parts.slice(1).join("/") === reference.file
  );
}
function license(value: unknown): string | null {
  const values = Array.isArray(value) ? value : [value];
  if (values.length !== 1 || typeof values[0] !== "string") return null;
  const match =
    /^https?:\/\/(?:www\.)?creativecommons\.org\/(?:licenses\/(by|by-sa)\/(1\.0|2\.0|2\.5|3\.0|4\.0)|publicdomain\/(zero|mark)\/1\.0)\/$/i.exec(
      values[0],
    );
  if (!match) return null;
  return match[1]
    ? `CC ${match[1].toUpperCase()} ${match[2]}`
    : match[3].toLowerCase() === "zero"
      ? "CC0 1.0"
      : "Public domain";
}
function creator(value: unknown): string | null {
  const values = Array.isArray(value) ? value : [value];
  if (
    !values.length ||
    values.some(
      (v) =>
        typeof v !== "string" ||
        !v.trim() ||
        v.length > 300 ||
        /[<>\x00-\x1f\x7f]/.test(v),
    )
  )
    return null;
  const result = (values as string[]).map((v) => v.trim()).join(", ");
  return result.length <= 300 ? result : null;
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
/** Parse only JPEG SOF and a bounded EXIF orientation directory; no image decoding. */
export function archiveJpegDimensions(
  bytes: Uint8Array,
): { width: number; height: number; orientation?: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  let dimensions: {
    width: number;
    height: number;
    orientation?: number;
  } | null = null;
  let orientation: number | undefined;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (
      marker === 0x01 ||
      marker === 0xd8 ||
      (marker >= 0xd0 && marker <= 0xd7)
    )
      continue;
    const size = (bytes[offset] << 8) | bytes[offset + 1];
    if (size < 2 || offset + size > bytes.length) break;
    if (
      [
        0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
        0xcf,
      ].includes(marker) &&
      size >= 8
    ) {
      dimensions = {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
      };
    }
    if (
      marker === 0xe1 &&
      size >= 16 &&
      String.fromCharCode(...bytes.subarray(offset + 2, offset + 8)) ===
        "Exif\0\0"
    ) {
      const start = offset + 8;
      const view = new DataView(
        bytes.buffer,
        bytes.byteOffset + start,
        size - 8,
      );
      const little = view.getUint16(0) === 0x4949;
      if (
        (little || view.getUint16(0) === 0x4d4d) &&
        view.getUint16(2, little) === 42
      ) {
        const directory = view.getUint32(4, little);
        if (directory >= 8 && directory + 2 <= view.byteLength) {
          const count = Math.min(view.getUint16(directory, little), 256);
          for (let i = 0; i < count; i++) {
            const entry = directory + 2 + i * 12;
            if (entry + 12 > view.byteLength) break;
            if (
              view.getUint16(entry, little) === 0x0112 &&
              view.getUint16(entry + 2, little) === 3 &&
              view.getUint32(entry + 4, little) === 1
            ) {
              const value = view.getUint16(entry + 8, little);
              if (value >= 1 && value <= 8) orientation = value;
            }
          }
        }
      }
    }
    offset += size;
  }
  return dimensions ? { ...dimensions, orientation } : null;
}

export async function resolveArchivePhoto(
  value: string,
  options: ArchivePhotoOptions = {},
): Promise<ArchivePhotoResult> {
  const started = Date.now();
  let requestCount = 0;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? options.timeoutMs!
    : 4500;
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(1, Math.min(timeoutMs, 4500)),
  );
  const signal = controller.signal;
  const fetcher = options.fetch ?? fetch;
  const result = (
    image: PlacePhoto | null,
    reason: string | null,
    retryable = false,
  ): ArchivePhotoResult => ({
    image,
    reason,
    retryable,
    requestCount,
    diagnostics: {
      rejected: reason ? { [reason]: 1 } : {},
      requestCount,
      elapsedMs: Date.now() - started,
    },
  });
  async function request(url: string, range = false): Promise<Response> {
    if (signal.aborted) throw new Rejection("timeout-or-abort", true);
    requestCount++;
    const operation = fetcher(url, {
      signal,
      redirect: "manual",
      headers: range
        ? { Range: `bytes=0-${HEADER_LIMIT - 1}`, Accept: "image/jpeg" }
        : { Accept: "application/json" },
    });
    void operation.then(
      (response) => {
        if (signal.aborted) cancel(response);
      },
      () => {},
    );
    return bounded(operation, signal);
  }
  try {
    const reference = parseArchivePhotoUrl(value);
    if (!reference) return result(null, "invalid-archive-url");
    const metadataResponse = await request(
      `https://archive.org/metadata/${reference.identifier}`,
    );
    if (!metadataResponse.ok) {
      cancel(metadataResponse);
      throw new Rejection(
        "metadata-http",
        metadataResponse.status === 429 || metadataResponse.status >= 500,
      );
    }
    if (
      metadataResponse.headers
        .get("content-type")
        ?.split(";")[0]
        .trim()
        .toLowerCase() !== "application/json"
    ) {
      cancel(metadataResponse);
      throw new Rejection("metadata-content-type");
    }
    const metadataBytes = await readBytes(
      metadataResponse,
      METADATA_LIMIT,
      signal,
    );
    let data: Record<string, unknown> | null;
    try {
      data = record(JSON.parse(new TextDecoder().decode(metadataBytes)));
    } catch {
      throw new Rejection("invalid-item-metadata");
    }
    const metadata = record(data?.metadata);
    if (
      !metadata ||
      metadata.identifier !== reference.identifier ||
      metadata.mediatype !== "image"
    )
      throw new Rejection("invalid-item-metadata");
    const attribution = creator(metadata.creator);
    const reusableLicense = license(metadata.licenseurl);
    if (!attribution) throw new Rejection("missing-creator");
    if (!reusableLicense) throw new Rejection("unlicensed");
    const files = Array.isArray(data?.files) ? data.files.map(record) : [];
    const matching = files.filter((file) => file?.name === reference.file);
    if (matching.length !== 1) throw new Rejection("missing-exact-file");
    const file = matching[0]!;
    if (
      file.format !== "JPEG" ||
      file.source !== "original" ||
      !Number.isFinite(Number(file.size)) ||
      Number(file.size) <= 0 ||
      Number(file.size) > 30 * 1024 * 1024
    )
      throw new Rejection("unsupported-file");
    // An explicit per-file restriction must never inherit a more permissive album licence.
    if (
      file.licenseurl !== undefined &&
      license(file.licenseurl) !== reusableLicense
    )
      throw new Rejection("file-license-conflict");
    let url = reference.download;
    let response: Response;
    let redirects = 0;
    while (true) {
      response = await request(url, true);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        cancel(response);
        if (!location || redirects++ >= MAX_REDIRECTS)
          throw new Rejection("unsafe-redirect");
        // Reject raw traversal before resolving a relative redirect with URL().
        if (
          /[\\\x00-\x20\x7f]/.test(location) ||
          location.split(/[/?#]/).some((part) => {
            try {
              return [".", ".."].includes(decodeURIComponent(part));
            } catch {
              return true;
            }
          })
        )
          throw new Rejection("unsafe-redirect");
        url = new URL(location, url).href;
        if (!trustedDownload(url, reference))
          throw new Rejection("unsafe-redirect");
        continue;
      }
      break;
    }
    if (response.url && !trustedDownload(response.url, reference)) {
      cancel(response);
      throw new Rejection("unsafe-redirect");
    }
    if (response.status !== 200 && response.status !== 206) {
      cancel(response);
      throw new Rejection(
        "image-http",
        response.status === 429 || response.status >= 500,
      );
    }
    if (
      response.headers
        .get("content-type")
        ?.split(";")[0]
        .trim()
        .toLowerCase() !== "image/jpeg"
    ) {
      cancel(response);
      throw new Rejection("image-content-type");
    }
    if (response.status === 206) {
      const range = /^bytes 0-(\d+)\/(\d+)$/.exec(
        response.headers.get("content-range") ?? "",
      );
      if (
        !range ||
        Number(range[1]) >= HEADER_LIMIT ||
        Number(range[2]) !== Number(file.size) ||
        Number(range[1]) >= Number(range[2])
      ) {
        cancel(response);
        throw new Rejection("invalid-image-range");
      }
    }
    const dimensions = archiveJpegDimensions(
      await readBytes(response, HEADER_LIMIT, signal, true),
    );
    if (
      !dimensions ||
      Math.min(dimensions.width, dimensions.height) < 300 ||
      Math.max(dimensions.width, dimensions.height) < 600 ||
      dimensions.width * dimensions.height > 100_000_000
    )
      throw new Rejection("invalid-jpeg-dimensions");
    let { width, height } = dimensions;
    if (dimensions.orientation && dimensions.orientation >= 5)
      [width, height] = [height, width];
    return result(
      {
        url: reference.download,
        source: reference.source,
        credit: attribution,
        license: reusableLicense,
        width,
        height,
        confidence: 1,
        strategy: "osm-archive",
        matched: [
          "OSM image",
          "exact Archive file",
          ...(dimensions.orientation
            ? [`JPEG EXIF orientation ${dimensions.orientation}`]
            : file.rotation && file.rotation !== "0"
              ? [`Archive rotation ${file.rotation}; original JPEG dimensions`]
              : []),
        ],
      },
      null,
    );
  } catch (error) {
    return result(
      null,
      error instanceof Rejection ? error.reason : "archive-upstream-error",
      error instanceof Rejection ? error.retryable : true,
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
