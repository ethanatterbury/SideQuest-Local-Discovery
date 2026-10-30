# Browsing repair implementation plan

**Goal:** Repair map search and layout, add real future planning, improve externally hosted image delivery without a photo warehouse.

**Architecture:** Keep live UK discovery and existing Next/MapLibre stack. Use free TinyFish search only to discover missing publisher URLs; existing identity and branch checks still vet photos. Separate labelled official logos from venue photography. Store bounded metadata only.

**Constraints:** No paid services, Supabase, national deployment dumps, automatic maintenance deployments or deletion of old deployments. User has authorized direct implementation and publishing to main; one verified release.

## Tasks

- [x] Reproduce and fix partial map name search and opted-in categories overriding text. Preserve semantic activity search and age/budget restrictions.
- [x] Verify TinyFish contract, add server-only bounded discovery with shared requests, cooldown and no paid endpoint fallback. Test missing key, matching/irrelevant/private URLs, quota exhaustion.
- [x] Add generic publisher-logo extraction with explicit media kind and provenance; keep branch photo checks. Recover failed image links by excluding the broken URL and resolving another approved candidate. Test this through browser delivery.
- [x] Add separate session planning state, London datetime conversion and selected-hour forecast with day-specific sunrise/sunset. Expose date/time and weather controls in the shell; manual weather clearly labelled. Test tomorrow, DST and unavailable forecast.
- [x] Compact map sidebar, edge-aligned wide header, map-only viewport without footer overflow. Put basemap selection under right controls; retain camera and all venues.
- [x] Remove quadratic marker preparation and repeated marker updates. Retain clustering, keyboard access, saved/visited state and exact marker positions. Measure dense fixture before/after.
- [ ] Run unit suite, lint, types, production build, trace-only cold boot and browser regressions. Inspect desktop/mobile together. Review patch and publish once; verify deployment status.

## Research

TinyFish pricing: free search 30/min and 500/hour; search reference also states 12,000/day, with paid wallet behavior beyond allowance. No card or funded wallet needed. Use search endpoint only; fetch has a separate 1,000 URL/day quota and is not used. StedaMaps charges $0.50/1,000 places plus $0.50/1,000 image-bearing places, so excluded. Public API directories are catalogues, not complete photo providers. Official photos remain on their original hosts; logos are labelled, never passed off as branch photography.

## Progress

Investigation: partial names were discarded as unrecognized intent; map extras reset search text; wide-header padding centers content above 1550px; footer hide selector cannot reach sibling footer outside main; broken supplied image prevents further resolution. Planning currently exists only as lab overrides, and forecast provider only reads current conditions.

Fresh independent review found three P2 cases: unchanged plans cleared a valid forecast, BST midnight selected previous-day solar bounds, and semantic search depended on whether preferences changed. Each regression was observed failing, then fixed; two unit regressions and the unchanged-plan browser regression pass. The reviewer also identified the process-local limiter's account-wide limitation, explicitly documented in the source-options report; no paid account-wide ceiling is claimed.

18 map/planning browser journeys passed, covering 360–2560px widths, cluster expansion/pan/zoom, keyboard access, saved and visited markers, selected-photo arrival, direct photo-failure recovery, and no national catalogue downloads. Three photo delivery/retry/attribution journeys passed separately. Desktop/mobile captures were checked together, with a second capture confirming the actual hydrated map. Venue deduplication microbenchmark: 5,000 identical inputs retained, 204.52ms before versus 1.73ms after; this is a local algorithm measurement, not a claim about end-to-end map frame rate.

Final sequential `npm run check`: 696/696 unit tests, lint, TypeScript, production build, deployment size guard and trace-only photo API boot all passed. A previous concurrent run with software-GPU browsers hit an existing Geoapify test's 5-second timeout and contaminated its following request count; the sequential full suite passed without changing those tests or their timeout. Public assets remain 4,896,486 bytes/47 files, with zero bundled national venues.

User clarification: TinyFish 30/minute is not accepted as a solution for 100 cold photo discoveries. It remains an optional, unconfigured gap-filler; no signup is necessary for the shipped direct-site and image-recovery changes. This release does not claim universal photo coverage.
