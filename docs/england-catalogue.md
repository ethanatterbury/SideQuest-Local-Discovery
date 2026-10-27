# England catalogue rebuild — 26 October 2026

Update, 27 October: the later [provider and product decision](provider-and-product-decision-2026-10-27.md) compares a Google-backed live places/photo pilot with the strict-free catalogue route, includes current Mapbox photo support, and gives account setup instructions. The open-data path below remains available; its earlier source preference is not evidence that it solved national coverage or photo availability.

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

## Further source checks and the production route

On 26 October the user requested ongoing publication to main. The tested classification/photo/import foundation was merged as f3f946d and Vercel reports its production deployment READY. This publishes code; it does not assert an England dataset was acquired.

Additional primary sources reviewed:

- OpenFreeMap's README explicitly offers its hosted vector basemap without API keys, registration or request/view limits: https://github.com/hyperknot/openfreemap . It explicitly does not provide search, routes, custom POI data or imagery. Keep this free map foundation; changing the basemap provider will not repair the venue catalogue.
- Geoapify's official grid/pagination example describes named POI downloads, 200-result pages, bounded geographic grids and a free key without a credit card for small-area testing. It directs readers to current pricing for quotas; no unverified daily quota is promised here. Its sample is a listings solution, not a reusable venue-photo collection: https://github.com/geoapify/maps-api-code-samples/tree/main/python/query-points-of-interest-with-places-api . A server-only GEOAPIFY_API_KEY in Vercel could enable a separately validated secondary listings provider. It is not integrated or required for the current release.
- All the Places documents first-party source URIs and periodic GeoJSON spider outputs, with stable-ID caveats: https://github.com/alltheplaces/alltheplaces/blob/master/DATA_FORMAT.md . Prefer published data rather than running all spiders. Test leisure/attraction operators separately; do not import general retail into default outing recommendations.
- Overture's official download tool supports bounded regional downloads. Its richer taxonomy/operating status can corroborate OSM, but its national coverage advantage has not been measured in this session: https://github.com/OvertureMaps/overturemaps-py .
- MapLibre's official HTML cluster example caches native markers instead of rebuilding them on every render: https://github.com/maplibre/maplibre-gl-js/blob/main/test/examples/display-html-clusters-with-custom-properties.html . Its sky/fog example concerns the pitched map horizon; it does not establish camera-independent overhead clouds: https://github.com/maplibre/maplibre-gl-js/blob/main/test/examples/sky-fog-terrain.html . SideQuest therefore uses its own screen-space, time-driven procedural atmosphere.

The practical data route remains: prepare the England extract once, deduplicate branches and nodes/ways, enrich supported experiences from evidence, resolve reusable photos ahead of browsing, serve geographic cells, and validate recommendation samples in cities, towns and rural areas. A venue website's lead image is a valuable identity/subject candidate but does not establish reuse permission. Missing photo coverage must stay visible in the audit. A premium result cannot be claimed from placeholder cards or a nationwide record count alone.

Openverse is another photo candidate source worth benchmarking after access is available. Its official repository describes a search engine for openly licensed media and links its consumer API. Authentication unlocks its standard application tier; the inspected server documentation does not establish a universal no-cost nationwide throughput guarantee. It is not a venue database and identity/branch validation remains necessary. No Openverse images were acquired or deployed in this release: https://github.com/WordPress/openverse ; https://github.com/WordPress/openverse/blob/main/documentation/api/reference/authentication_and_throttling.md .
