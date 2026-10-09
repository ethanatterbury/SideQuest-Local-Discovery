# SideQuest V2 implementation record

Approved 9 October 2026. Preserve Next.js, React, Manrope/DM Sans, local saved state and portable provider boundaries. Implement on `feat/sidequest-v2`; one commit per phase, no deployment.

## Phase 1 — Contracts and delivery foundation
Optional, backward-compatible evidence/access/interest contracts; geographic cells and shared latency budgets. Existing source snapshots are the bootstrap, not a claim of nationwide precomputed coverage.

## Phase 2 — Discovery and UK pipeline
Eligibility before relevance before diversity. Food, pubs, fitness and shops default off; explicit selection enables them. Strict accessibility/age requirements fail closed. Balanced candidates across the travel area, impression novelty, no ID-specific fixes. Build spatial shards from existing licensed records and accept arbitrary UK OSM extracts; background live refresh has a bounded total deadline. Shared area cache and local IndexedDB, no synchronous localStorage catalogue writes. Test inappropriate candidates, diverse results, UK bounds and timeout recovery.

## Phase 3 — Photography and design
Reuse demonstrably licensed existing photos; default rights policy excludes rights-reserved prepared assets without permission. Multiple identity-checked source adapters, bounded delivery, negative caching. Remote metadata and a bounded thumbnail preparation tool; no new photo crawl during this task. Premium warm-paper/forest visual direction, large genuine imagery, useful explanations, consistent native controls and minimal location transition. Verify actual phone/desktop surfaces.

## Phase 4 — Map and atmosphere
MapLibre + OpenFreeMap, original British landscape palette, UK camera bounds, vector clustering and accessible selection. GPU rain/snow/cloud/wind/fog/solar lighting with shared Lab presets, quality adaptation, reduced-motion and hidden-tab handling. List fallback on unavailable maps. Verify clear/rain/snow/storm/night and mobile Lab in bounded browser passes.

## £0 operating envelope
No paid keys, accounts or metered billable products introduced. Public services are best effort. Vercel Hobby and Open-Meteo hosted free service must remain within applicable non-commercial terms; commercial hosting needs a separately verified eligible free arrangement. Static geographic cells are portable to a free CDN. CI ingestion is opt-in and bounded, not an unbounded scheduled national download. No automatic paid overflow. Images need source reuse rights, not merely attribution. UK-wide query capability does not guarantee nationwide factual/photo completeness.

## Rulings and evidence
- User explicitly approved autonomous execution; no additional design approval gates.
- Keep packaged open-licensed photography as a migration bootstrap; discontinue rights-unverified media by default rather than deleting source evidence.
- External venue/map/weather domains are not allowed by this execution environment. Visual verification must distinguish real local renderer execution with deterministic map fixtures from live hosted-provider connectivity.

## Implementation and verification — 9 October 2026
- Four implementation commits on `feat/sidequest-v2`; no deployment, push, paid service or new venue/photo crawl.
- Existing source snapshot: 7,182 records; geographic preparation: 7,180 normalized venues in 27 cells after generic ancillary filtering. UK-wide adapters/import tooling exist; nationwide prewarming remains unpopulated.
- Rights policy: 29 approved prepared photos, 279 excluded rights-unverified/rights-reserved records, existing licensed curated assets retained. Local materialization extracts only approved members; new preparation defaults to remote metadata. An accurate photo for every venue is not promised.
- Discovery: multi-interest relevance, optional categories, strict positive access evidence, age/height conservatism, identity/parent deduplication, impression novelty and explicit-nature-aware diversity. Final visual review caught heathland classification and changing facilities; generic rules and regression coverage now handle both.
- Local desktop/mobile visual matrix executed actual MapLibre and GPU atmosphere with deterministic GeoJSON fixtures. Clear, heavy rain, snow, storm, golden-hour cloud states and reduced motion were inspected; no horizontal overflow or browser runtime errors. Initial results in the development sample appeared in 893–3,679 ms, not a production latency guarantee.
- Release unit suite: 256 passing tests across 22 files. Lint, TypeScript and optimized production build pass. All five focused browser tests pass (single-worker, 1.3 minutes): map failure/retry, saved/visited marker activation, pan/search camera preservation, desktop/mobile GPU pixel contribution and reduced-motion/hidden-tab stability.
- Remaining validation: live hosted map/Overpass/Open-Meteo/photography connectivity is restricted by this execution environment. Those services need verification in an eligible hosting environment. Broader legacy browser flows were migrated where renderer assumptions changed, but the full e2e suite and production offline smoke were not run.
