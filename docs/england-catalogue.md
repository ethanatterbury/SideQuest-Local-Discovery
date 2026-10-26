# England catalogue rebuild — 26 October 2026

The user authorised autonomous research and implementation, narrowed geographic priority to England, and made place quality, photographs, filtering and recommendations the priority. Preserve Discover, Map and Plan my day; the rejected visual concepts are not an approved replacement design.

## Source decision

Compare prepared OSM extracts with Overture and All the Places. Overture's current places schema offers alternate categories, websites and operating status, but no venue-photo collection; existence confidence is not visitor quality. All the Places supplies regularly published first-party location metadata under CC0, not a reusable photo collection. Use the existing OSM pipeline for the foundation and retain provider boundaries for later corroboration. Sources: https://github.com/OvertureMaps/schema/blob/main/schema/places/place.yaml ; https://github.com/OvertureMaps/overturemaps-py ; https://github.com/alltheplaces/alltheplaces . This is an architectural comparison, not a measured England coverage comparison: their national datasets were not retrieved here.

## Implementation and acceptance

1. Make primary experiences explicit, backed by mapped or official evidence. A primary play experience survives the food opt-out; an incidental playground at a pub does not bypass it. Map and recommendation food classification share one rule. Names alone establish nothing.
2. Choose the best approved, identity-matched prepared photo across available sources, rather than stopping at the first stored photo. Prefer subject confidence before resolution/crop. Keep attribution, reuse checks and branch identity. This improves selection among known candidates; it does not create absent photographs.
3. Supply an England preparation command with a bounded download, source metadata, atomic output and a coverage gate. Prepare geographic cells and an audit from the same source. Reject a three-county snapshot as an England release. Retain existing regional fallback until a validated replacement exists.
4. Run regression tests, full unit suite, typecheck and production build. Report measured coverage and unresolved sources rather than claiming nationwide completeness.

## Current external blocker

The selected execution environment only allows package/source hosts. A direct request to download.geofabrik.de returned HTTP 403 at the outbound proxy; Wikimedia and official venue domains are not allowlisted. Firecrawl was already out of credits. National download and fresh venue/photo enrichment cannot be truthfully verified from this environment. No alternate proxy or unrelated execution service will be used to evade that policy.

## Verified implementation result

268 Vitest tests and seven Python checks pass, including actual Pyosmium node/multipolygon parsing. Typecheck, ESLint and the optimized Next build pass. The build required the execution tool's supported network permission so Next could spawn its TypeScript subprocess; no typechecking was disabled. Independent code review found and corrected incidental pub-play promotion and missing photo assets in the generated artifact.

The source audit has 7,180 normalized regional places and 45 approved prepared photos (0.63%). This counts the full existing regional catalogue, not the earlier 200-place sample or a claim of rendered image quality. The source snapshot contains no pub/bar/shop records; filters cannot create categories absent from the source. The England coverage smoke gate correctly rejects this snapshot.

After network access is enabled, install `osmium==4.3.2` for the selected Python, run `npm run prepare:england`, then `npm run audit:catalog -- src/providers/data/regions/england.json`. Review geographic coverage, candidates, photo provenance and rendering before publishing. The manual CI workflow performs preparation and packages referenced local media, but is not an automatic ongoing ingestion/publication service. A zero-exit smoke gate is not proof of complete venue coverage or good recommendations.
