/** Commons originals and the separate thumbnail CDN returned by imageinfo. */
export function safeCommonsImageUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !(
      value.startsWith("https://upload.wikimedia.org/") ||
      value.startsWith("https://thumb.wikimedia.org/")
    )
  )
    return false;
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.port &&
      ((url.hostname === "upload.wikimedia.org" &&
        url.pathname.startsWith("/wikipedia/commons/")) ||
        (url.hostname === "thumb.wikimedia.org" &&
          url.pathname.startsWith("/wikipedia/commons/thumb/")))
    );
  } catch {
    return false;
  }
}
