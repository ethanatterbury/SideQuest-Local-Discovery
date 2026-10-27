/** Static Lucide-style symbols; no place data enters marker HTML. */
export function markerGlyph(
  category: string,
  saved: boolean,
  visited: boolean,
) {
  const value = category.toLowerCase();
  // Lucide's standard category glyphs, expressed as static SVG for MapLibre markers.
  const shapes = /museum|gallery|arts|heritage|castle/.test(value)
    ? '<path d="M10 18v-7M14 18v-7M18 18v-7M6 18v-7M3 22h18M3 7h18L12 2z"/>'
    : /garden|park|walk|wood|nature/.test(value)
      ? '<path d="M10 10v.2A3 3 0 0 1 8.9 16H5a3 3 0 0 1-1-5.8V10a3 3 0 0 1 6 0ZM7 16v6M13 19v3M12 19h8.3a1 1 0 0 0 .7-1.7L18 14h.3a1 1 0 0 0 .7-1.7L16 9h.2a1 1 0 0 0 .8-1.7L13 3l-1.4 1.5"/>'
      : /food|caf|coffee|restaurant|pub|bar/.test(value)
        ? '<path d="M10 2v2M14 2v2M4 7h16v3a8 8 0 0 1-16 0V7ZM4 22h16M20 7h1a2 2 0 0 1 0 4h-1"/>'
        : /play|kids|soft/.test(value)
          ? '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>'
          : /fitness|climb|swim/.test(value)
            ? '<path d="m6.5 6.5 11 11M21 21l-1-1M3 3l1 1M18 22l4-4M2 6l4-4M3 10l7-7M14 21l7-7"/>'
            : /shop|market/.test(value)
              ? '<path d="M16 10a4 4 0 0 1-8 0M3.1 6h17.8l1 13a2 2 0 0 1-2 2H4.1a2 2 0 0 1-2-2l1-13ZM7 6l1-4h8l1 4"/>'
              : '<path d="M20 10c0 5-5.5 10.2-7.4 11.8a1 1 0 0 1-1.2 0C9.5 20.2 4 15 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>';
  const symbol = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes}</svg>`;
  const badge = saved
    ? '<svg class="sq-marker-badge" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M3 1h6v10L6 8l-3 3z"/></svg>'
    : visited
      ? '<svg class="sq-marker-badge" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m2 6 3 3 5-6"/></svg>'
      : "";
  return symbol + badge;
}
