# No-billing SideQuest overhaul Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the independent provider and presentation tasks; root handles photo delivery and integration. Existing user authorization covers implementing and publishing tested progress to main without another design approval round.

**Goal:** Replace the rejected interface and add a no-card national discovery provider while repairing avoidable photo-loading failures.

**Architecture:** Keep Next/React, the existing eligibility engine, map rendering and Plan my day. Geoapify Free supplies live OSM-derived listings on demand when configured, with regional/Overpass fallback. External approved photographs remain externally hosted; this release will not acquire or store a national image library, activate billing, or promise complete photo coverage.

**Spec:** Existing user requirements plus docs/provider-and-product-decision-2026-10-27.md, superseded here on billing: Google billing is ruled out and Apple is only a researched candidate. The user wants a premium clean/simple website, useful exact-age recommendations, ordinary cafes/pubs off, genuine primary play cafes included, England coverage, real photos, map exploration and improved planning.

## Global constraints

- No paid signup, Google billing, photo warehouse, rights-unverified venue imagery or unrelated stock substitutes.
- Direct main publication is authorized. Keep shared suitability gates across all journeys.
- No outside-area coverage claim until the configured live provider has been exercised there.
- Replace the old warm-paper marketing layout with a practical near-white/charcoal interface, restrained blue primary actions, real images, compact metadata and reduced filter clutter. This is the lead designer's choice under the user's instruction to proceed; rejected mockups have no authority.
- Preserve saved places/history, keyboard navigation, mobile operation, reduced motion and honest missing-data states. Stop calling unknown infant activities verified matches.

## Review focus

1. Empty/invalid/rate-limited provider responses must fall back without falsely claiming live coverage.
2. Raw mapped restrictions and primary-play evidence must survive conversion; categories/names alone cannot invent infant suitability.
3. Multiple visible photo cards must not expire in a queue before receiving network time; concurrency stays at three and failures retry boundedly.
4. Reloading, changing location, map selection and new plans must preserve shared preferences and source identity.
5. Missing photos and narrow screens must retain usable place details and controls without giant empty photo panels or horizontal overflow.

### Task 1: Free national listings

**Owner:** provider implementer. **Files:** new src/providers/geoapify-places.ts and tests/geoapify-places.test.ts; integrate src/app/api/places/route.ts, nearby live-detail registry as needed, source messaging in src/providers/place-catalog.ts, .env.example and provider setup documentation.

- [ ] Add and observe failing conversion/integration tests using actual documented Geoapify GeoJSON structure: OSM node/way identity, lat/lon, raw tags/media references, private/closed exclusion, unsupported records, malformed payload, no key, timeout/429.
- [ ] Implement bounded separate activity/food retrieval so catering cannot crowd out outings; key stays server-only. Preserve existing normalization and age rules rather than classifying by venue names. Limit/cache requests and deduplicate.
- [ ] Add route integration with accurate source attribution and fallback. Keep direct place details and reload working for newly discovered venues. Add optional free-key setup instructions; do not claim photos supplied by Geoapify.
- [ ] Run focused tests and type checking as appropriate. No full build/browser parallel with root. Do not commit shared work; report exact files/results/limits.

### Task 2: Website replacement

**Owner:** UI implementer. **Files:** Discover/PlaceCard, shell, map presentation/markers, itinerary presentation, dedicated redesign CSS/layout import, DESIGN.md; only relevant browser selectors if factual new copy requires it. Do not edit provider/domain/photo logic or primitives.tsx (root owns photo delivery).

- [ ] Inspect committed current desktop/phone captures and existing flows. Replace the duplicated Discover/Explore marketing arrangement with a useful discovery workspace: first-viewport search/preferences and direct Discover/Map/Plan paths, high-quality photo-led results when images exist and compact honest missing-photo rows.
- [ ] Carry the new white/charcoal/blue identity across navigation, saved/history/detail/planning, map results, clean standard category markers and mobile sheets. Improve planning control hierarchy while preserving its behavior and explicit estimates.
- [ ] Reduce the initial filter burden without hiding necessary group/ages/time/travel/details. Keep meaningful labels, consistent focus/disabled/loading/empty/error states. No fake photos or invented live facts.
- [ ] Update DESIGN.md to the replacement world. Type/lint focused changed files. Root will run frozen production build + serial browser journeys and batched desktop/mobile visual inspection; do not start Chromium/build concurrently.

### Task 3: External photo delivery and integrated verification

**Owner:** root. **Files:** photo-client.ts/tests, external image delivery where evidence justifies it, research/update documents.

- [ ] Reproduce queued visible photos timing out before any network call; test a later batch receives a full bounded request window with three-request concurrency and no leaked slots.
- [ ] Correct queue lifecycle with a bounded queue wait and separate active deadline; preserve deduplication, transient retry and rights/identity checks. Do not loosen provenance to inflate photo counts.
- [ ] Verify actual production photo diagnostics where tools allow; distinguish remote source absence, upstream failures and rendering bugs.
- [ ] Complete Apple research from primary docs: web versus native, paid membership, place-card availability versus general image URLs, actual quotas. No speculative free-photo promise.
- [ ] Review each implementation task, resolve important issues, run full lint/types/unit/build, meaningful browser journeys and one batched desktop/phone inspection with at most one correction round. Publish main and confirm Vercel SHA/readiness/response. State what is still missing and the one free setup step.

## Execution ledger

- Base: 3257317. Working tree initially clean. User explicitly reiterated full website overhaul and ruled out billing and national photo storage.
- Network policy remains package/source hosts only, no runtime secrets. Connector web research is available; live API/dataset ingestion cannot be verified from this executor. Do not evade network policy.
- Impeccable launcher unavailable; read PRODUCT.md, DESIGN.md, replacement-work and craft-floor guidance directly. User-directed simple modern practical interface overrides speculative concept rounds.
- Implemented three separate bounded Geoapify batches, stable OSM detail lookup, source attribution, fallback/cache handling and raw restriction preservation. Scoped review found and fixed activity-batch fallback, degraded CDN caching and commercial-category retrieval issues; 44 focused provider/catalogue tests passed.
- Replaced Discover/Explore marketing duplication with the shared discovery workspace, direct map/day-planning actions, consistent white/charcoal/blue surfaces and recognisable category markers. Review found and fixed hidden persisted intent; the active preference now has a visible clear control.
- Reproduced and fixed photo requests expiring while queued. Twelve visible slow photos now each receive an active request window, with three concurrent requests, bounded queue/timeout cleanup, transient retry and the same identity/rights checks. Six client tests and the browser transient-photo retry case passed.
- Full final lint, types, 307 unit tests and production build passed. Later test-harness changes also passed focused ESLint and type checking. No product source changes followed that production build.
- Serial browser checks passed all 26 core app, live discovery and map-selection journeys, plus three food-filter map cases, photo retry, keyboard marker/panning and map failure/recovery. The production browser harness now intercepts hosted style requests rather than relying on a development-only window override.
- Software-GPU lab checks exposed two harness issues: controls clipped within their own scroll panel and 1/255 compositing rounding despite zero animation draws. Tests now scroll controls explicitly and compare decoded pixels with one-channel-level tolerance; no weather renderer logic was changed. Remaining lab verification and final five-view capture are recorded below when completed.
- Final independent whole-patch review found no material issues after the scoped corrections. National provider compatibility remains unproven until the production deployment runs with the user's key.
- The owner challenged landmark-only photo evidence. Added a separate representative local-venue audit, documenting official-site candidate pitfalls and the absence of a verified comprehensive no-billing venue-photo feed. No permission, external image or nationwide hit rate is invented.
- All 36 distinct browser cases have now passed across the serial runs. The final GPU-only run passed desktop/mobile weather changes without map recreation (49.8s) and reduced-motion/hidden-tab pause/resume (32.4s); the camera-independence case passed in the previous run. Software-GPU startup/recording can exceed the old test timeout, so the lab suite permits four minutes while individual checks retain their bounded expectations. No assertion was removed and no product renderer change was needed.
- Final visual inspection covered Discover desktop/phone, map desktop/phone and the phone day-planning dialog. All five captures reported no horizontal overflow or browser errors. The map captures use explicitly fictional local geography for renderer isolation; they do not verify hosted map availability. The single presentation correction tightened mobile spacing and completed shared surface colors. No further product edits followed this confirmation round.
- Ready for the explicitly authorized main publication. Post-deployment checks must still confirm the Git SHA, Production alias, Geoapify source/counts outside the regional snapshot and a newly discovered direct-place detail. Photo completeness remains unsolved, including the representative Jake's diagnostic failure; this release must not be described as solving it.
- Published 3a4a682 to main; Vercel dpl_6UQhRno6Z8bKdW3SugbGF2UHijLX is READY on the Production alias. Live Manchester/Newcastle requests revealed a real integration failure: commercial batches returned 95/97 shops, but activity/food batches produced no usable candidates and fell back. These do not establish working default national discovery. Added sanitized server diagnostics (batch/status/timeouts/empty raw-field names, never key/URL/body) to establish the failing boundary before changing the adapter. The user was explicitly told national discovery was not yet working.
- The instrumented main deployment eae45f7 established the cause: both activity and catering fetches were aborted before response headers at 2,504/2,485ms; commercial completed sooner. A regression representing a successful three-second activity response failed under the old deadline. Increased the shared provider deadline to 5.5s, leaving the existing four-second fallback within the client's ten-second load budget; the route's platform ceiling is 15s to avoid clipping server cleanup. No billing/plan/region setting was changed. Re-run full checks and live outside-area verification for this correction.
