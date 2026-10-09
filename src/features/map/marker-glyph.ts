/** Authored 24px symbols; only static path literals enter marker HTML. */
export function markerGlyph(
  category: string,
  saved: boolean,
  visited: boolean,
) {
  const value = category.toLowerCase();
  const path = /museum|gallery|arts|heritage|castle/.test(value)
    ? "M4 9h16M5 20h14M7 10v7m5-7v7m5-7v7M3 7l9-4 9 4"
    : /garden|park|walk|wood|nature/.test(value)
      ? "M12 21v-8m0 3C3 17 3 7 5 5c4 0 7 4 7 8 0-6 4-9 7-9 2 7-1 12-7 12"
      : /food|caf|coffee|restaurant|pub|bar/.test(value)
        ? "M5 5v5m3-5v5m-3-2h3m-1.5 2v10M16 5v15m0-15c-4 3-4 7 0 7"
        : /play|kids|soft/.test(value)
          ? "M4 19h16M6 19V6h7v4l6 9M6 10h7M6 14h7"
          : /fitness|climb|swim/.test(value)
            ? "M3 9v6m3-8v10m0-5h12m0-5v10m3-8v6"
            : /shop|market/.test(value)
              ? "M5 9h14v11H5V9zm3 0V6a4 4 0 0 1 8 0v3"
              : "M5 20v-8c0-4 3-6 7-6m0 0 4-3m-4 3 4 3M12 6v8l7 6";
  const symbol = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
  const badge = saved
    ? '<svg class="sq-marker-badge" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M3 1h6v10L6 8l-3 3z"/></svg>'
    : visited
      ? '<svg class="sq-marker-badge" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m2 6 3 3 5-6"/></svg>'
      : "";
  return symbol + badge;
}
