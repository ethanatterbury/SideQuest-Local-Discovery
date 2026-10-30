# SideQuest search responsiveness repair

Scope is SideQuest only. The recruitment/job-tracker website is explicitly excluded.

- Keep the search draft inside a small form component. Submit with Enter or the search button; typing must not change shared query state, preference storage, history or map camera.
- Stop writing the query and filters into the URL. Continue reading incoming links; clear obsolete SideQuest query parameters once on an explicit filter/search change.
- Preserve global filters, selected-hour planning, age restrictions and all eligible venues.
- Profile recommendation ranking and remove repeated work while preserving result ordering, deduplication and diversity. Reuse UK time formatters.
- Investigate photo resolution separately; do not relax identity checks or create an image warehouse. Record concrete source/transport gaps instead of claiming universal coverage.
- Verify dense-catalogue typing, submit and clearing on map/discovery in a production build; run full unit/lint/type/build checks. Publish one verified release to main.

Initial evidence: every input event calls global setQuery, synchronous preference persistence and Next-integrated history.replaceState. Ranking a 300-venue fixture took 1.46s without text and 0.76s for a matching term. A 1,000-venue fixture took 10–18s per pass. diversifyRecommendations repeatedly sorts the remaining list and classifies the same venues inside its comparators. The map also computes an entire second ranking even when no optional category is enabled.

Additional verified failures and repair scope:

- Whole theme-park admission was subject to individual ride age checks, so Family with optional ages left blank suppressed parks. Preserve actual admission limits and individual ride/bowling checks.
- Keep mapped interior rides/playgrounds available through an explicit interior toggle and text searches. Group only subordinate categories with source bounds or explicit parents; retain separate museums/hotels/water parks. Never infer venue identity from a named example.
- Native WebGL loss sets MapLibre's style to null. Effects reading getSource during that interval threw and replaced the map with an error boundary. Guard that interval and rebuild custom sources after style restoration without moving the camera.
- The floated layer-picker legend collapsed the Default radio's first row to zero width. Clear the float and prevent radios shrinking. Remove the redundant Street mode.
- Recover from vector-provider failure using actual independently decoded OSM geographic tiles. Style load or coordinate diagrams are not proof that map geography is working.
- Budget map backing buffers to 8 million pixels and atmospheric effects to 1 million, preserving normal viewport density and every eligible result.

Verification to date: ranking 1,000 venues now took 57.3ms (empty query) / 33.5ms (matching term) in the same benchmark; fixed mixed-order golden and 100 randomized old/new diversity comparisons match. Dense browser fixture uses the real per-area maximum of 500 venues under 4× CPU throttling, tests draft typing/submit and repeated filters. No catalogue cap was added. Layer round trips, provider fallback and native graphics restoration have passed browser checks. Photo resolution remains incomplete and is not claimed fixed in this stability patch.

Release verification: `npm run check` passed (lint, typecheck, 735 tests / 61 files, production build and traced-runtime cold boot). Production browser run passed 12 scenarios; the existing marker test compared coordinates before a 500ms camera animation finished and used development-only overrides. Corrected that harness to use the actual reduced-motion media preference, mock weather and poll settled positions; isolated production rerun passed. The 13 verified scenarios cover attraction overview/search, wide and mobile layouts, selected forecasts, external image replacement, dense typing/filtering, basemap round trips, independent geographic fallback, context restoration and projected marker positions. Public assets remain 4,896,486 bytes / 47 files; bundled national venues remain zero.
