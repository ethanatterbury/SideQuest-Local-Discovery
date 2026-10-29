/** Reviewed source-file rejections; the venue itself remains eligible for photos. */
export const rejectedPhotoSources: readonly {
  source: string;
  reason: "different-business";
  reviewedAt: string;
  description: string;
}[] = [
  {
    source:
      "https://archive.org/details/windsor-2018-09-15/Windsor%202018-09-15/DSCN7610.JPG",
    reason: "different-business",
    reviewedAt: "2026-10-29",
    description:
      "Shows Café Copia, a different business at the premises, rather than Dr Chocs.",
  },
];

/** File identity survives a rendition or cosmetic URL change, never a filename change. */
function sourceIdentity(source: string): string | undefined {
  if (!source || source.length > 4096 || /[\\\x00-\x1f\x7f]/.test(source))
    return;
  try {
    const url = new URL(source);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port
    )
      return;
    const parts = url.pathname.slice(1).split("/").map(decodeURIComponent);
    if (parts.some((part) => !part || /[\\/\x00-\x1f\x7f]/.test(part))) return;
    if (
      url.hostname === "archive.org" &&
      parts.length >= 3 &&
      ["details", "download"].includes(parts[0])
    )
      parts[0] = "details";
    return JSON.stringify([url.hostname, ...parts]);
  } catch {
    return;
  }
}

const rejectedIdentities = new Set(
  rejectedPhotoSources.map((entry) => sourceIdentity(entry.source)),
);

export function rejectedPhotoSource(source: string): boolean {
  const identity = sourceIdentity(source);
  return identity !== undefined && rejectedIdentities.has(identity);
}
