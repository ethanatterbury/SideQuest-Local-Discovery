# Discovery and marker correction — 28 October 2026

## Reproduced causes

- Cached marker updates replaced the element's whole class attribute, deleting MapLibre's positioning/state classes. Place-marker CSS also overrode absolute positioning with relative positioning. Both issues added normal document layout to geographic projection.
- Successful category-capped Geoapify discovery discarded available OSM snapshot venues. Provider success was incorrectly treated as complete coverage.
- Exact venue lookup compared literal names, so `and`, `&`, `+` and mapped aliases could produce different search behavior.
- Browser photo requests expired after the same 4.5-second budget used by the server, allowing no request/response transport time.

## Corrections and boundaries

Marker updates preserve library classes and use absolute positioning. A browser regression compares actual button centers with independently calculated geographic projection after cluster expansion, zoom, pan and selection.

Discovery merges available snapshot venues with live results; live identities take precedence. This uses existing local files, without additional API calls. Exact lookup normalizes written name variants and aliases, while category opt-ins and child-age checks still apply.

The existing Godalming catalogue contains Small & Mighty (`osm-way-403382388`), recorded only as `amenity=cafe`, without a website or play tags. The regression reproduces a Kids/age-3 search with cafés enabled against the capped 300-place catalogue. No venue-specific production classification was added. Finding this café is not proof that play cafés are correctly classified throughout England.

Browser photo requests allow two seconds of transport time beyond the server lookup budget. This fixes premature cancellation, not source coverage. Wikimedia/Archive coverage is inadequate for many local commercial venues. Existing official-website parsing does not establish reuse permission, and no universal free business-photo source has been integrated.

`29f6d62` was confirmed READY on the production alias, with a successful Vercel GitHub status. Its separate [GitHub quality run](https://github.com/ethanatterbury/SideQuest-Local-Discovery/actions/runs/40521358538) failed: build/unit checks succeeded, but the map failure/retry browser case timed out waiting for fallback status while the UI still said “Opening the map…”. The other 35 browser cases passed in that run. A deployed build and a green complete test run are distinct checks.

## Photo alternatives checked

- [Geoapify place details](https://apidocs.geoapify.com/how-to/place-discovery/place-details-by-id-or-coordinates): optional website/wiki/media fields depend on source completeness; they do not guarantee a business photo.
- [Foursquare pricing](https://foursquare.com/pricing/): photos are Premium endpoints. Its free Pro allowance is not a free photo allowance.
- [Apple Maps Embed](https://developer.apple.com/documentation/mapkitjs/displaying-place-information-using-the-maps-embed-api): requires an Apple place ID and Maps token and renders Apple's own place/map view. It is not documentation for extracting standalone images into SideQuest cards.
- [TomTom POI photos](https://docs.tomtom.com/poi-photos-api/documentation/poi-photos-api/poi-photos): automotive-only access; explicitly excluded from free evaluation/PAYG.

These checks do not establish a no-billing source with comprehensive local-venue photographs. No new account, paid service or stored image collection was added in this patch.

## Verification boundaries

Lint, TypeScript, 323 unit tests and the production build passed for the application changes. The new real-WebGL marker regression passed, checking projection after cluster expansion, zoom, pan and selection. The first complete browser run passed 35/37 cases; prepared-data ordering and the combined desktop/mobile weather-pixel case timed out. The prepared-data check was corrected to avoid spending its held-response deadline on image loading/GPU startup and passed on rerun. The map fallback/retry case also passed on rerun.

Software-rendered weather checks remain a separate investigation; this patch does not change production weather rendering or claim that the complete weather/browser suite is green. CI now serializes browser files to avoid competing software-WebGL workloads.
