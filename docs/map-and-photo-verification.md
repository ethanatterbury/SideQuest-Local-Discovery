# Map and automatic venue photography

Verified on 8 October 2026. The user flow is: map filters and Lab presets → shared environment and eligibility → Leaflet geography/weather rendering, and visible place → photo API → free venue media → credited image. Photography never changes recommendation eligibility, scores, ordering or itinerary selection.

## Map and weather

Leaflet is now the primary renderer with or without WebGL. Health requires visible, decoded raster tiles rather than a successfully loaded vector style. Missing geography produces an explicit unavailable state and retry action. Camera position survives photo arrival and Search this area; selection, current position, saved/visited markers, travel radius and estimated connections remain available.

Food & coffee is a separate, unchecked-by-default checkbox beneath the map outing dropdown. Checking it adds food venues alongside the selected outing type. Museums, arts centres and gardens with incidental cafés remain outings. Explicitly linked food places stay navigable. Discover retains its own Food & coffee activity option.

Overcast, partly cloudy and rain have two softly shaded cloud layers drifting on independent 38s/53s paths. Fine diagonal rain uses 12 drops, or 24 in heavy rain, plus four sparse surface ripples. Effects remain beneath controls and pointer-free. Reduced motion leaves static shading; hidden tabs stop particles and pause ambient animation. The Lab's Normal motion preference can explicitly override a system reduced-motion setting. Selecting a weather preset clears conflicting weather/offline failure toggles; those toggles can still be deliberately enabled afterwards.

The production browser showed real roads, parks, rivers and labels, 25 decoded street tiles, and the new checkbox unchecked. Checking it changed the eligible marker count from 164 to 267 in that observation. Live partly-cloudy cloud transforms changed between frames. Desktop 1440×1000 and mobile 390×844 rain captures use **real deployed map tiles with a simulated browser forecast response**, not fabricated geography or claimed live rain. Rain transforms changed; mobile horizontal overflow was false. These public-route checks do not establish protected Lab visual verification.

- [Desktop with live cloud weather](verification-assets/map-desktop-live-clouds.jpg)
- [Desktop with simulated rain over real streets](verification-assets/map-desktop-simulated-rain.jpg)
- [Mobile with simulated rain over real streets](verification-assets/map-mobile-simulated-rain.jpg)
- [Deployed Explore](verification-assets/explore-desktop.jpg)

Local regression checks also compare actual weather pixel contribution above decoded fixture tiles, cloud/drop movement, marker hit-through, explicit/automatic motion preferences, hidden-tab pause/resume, Lab failure conflicts, geography failure/retry and food filtering. Fixture screenshots are not substituted for deployed tile evidence. The production build and TypeScript checks include the weather screenshot test cleanup correction. The Archive API-to-browser path is covered by a decoded fixture image and credit/source test; this is an integration regression check, not a deployed Archive photograph screenshot.

Production: https://sidequest-local-discovery.vercel.app/map

Stable protected Lab: https://sidequest-environment-lab-ethan-d892.vercel.app/dev/environment

The stable Lab alias is reassigned on releases so old immutable preview URLs do not silently show earlier code. Production keeps the Lab disabled. Anonymous preview requests still require Vercel authentication. Sending a temporary protected-preview credential to Firecrawl was rejected by automatic approval review because it would disclose access to that external browser service; that credential was revoked. No protection was disabled. Private Lab screenshots remain unverified through that service unless the user explicitly authorizes that access.

## Automatic photo pipeline

The resolver consumes preserved OSM image/Commons/Wikidata/Wikipedia/alias metadata; declared entity photos and Commons categories; Wikipedia redirects and page images; town-aware Commons searches; nearby files with captions, categories, coordinates and structured depicts evidence. It ranks credible, licensed photos by subject evidence, location and photographic quality, preserving an explicit binding over substantially weaker name matches, preferring useful landscape imagery at least 1,200px wide. Genuine lower-resolution or portrait photos remain fallbacks after better candidates are considered. Unknown branch, conflicting location, incidental nearby subjects, artwork, logos, stock images and unsupported licensing are rejected. Subject names match within separate metadata fields and retain the full venue name: a memorial hall is not presumed to be memorial grounds. Venue-named street addresses and numeric inventory labels cannot supply subject or town identity. A whole venue exterior remains eligible when it also carries a plaque; a plaque detail alone does not establish a restaurant exterior.

Direct OSM Archive image references are resolved automatically from the exact item/file path, verified against the original JPEG inventory, creator and reusable album licence. Downloads use restricted Archive paths and mirrors, a 4.5-second total budget, a 1 MiB metadata cap and 128 KiB JPEG header reads. EXIF orientation determines displayed dimensions; metadata-only rotation is identified in evidence. The image optimizer serves appropriately sized images, and the browser validates paired canonical image/source URLs. Exact Geograph photo IDs resolve through their licensed Commons copies. Arbitrary external website and GitHub images remain unsupported without verified reuse rights. See [direct media audit](direct-osm-media-audit.md). These sources use venue metadata rather than a manual venue-to-photo table.

Regional OSM media metadata was refreshed for all 7,182 records through 37 official API batches, preserving geometry. `scripts/refresh-osm-media.py` records provenance and retains image, Commons, alternate and old-name tags. Positive photo verification is persisted in `src/providers/data/place-photo-index.json`; `scripts/enrich-place-photos.mjs` creates resumable, atomic checkpoints independently of recommendation ordering. Refresh failures preserve previously verified photographs and their original verification date.

A photo-specific cache version revalidates older browser photographs against current curated photos and the verified index while retaining cached venue records and saved IDs. Unverified old images can be resolved again rather than silently surviving a matcher correction.

Positive generated entries expire after 30 days; honest unresolved entries after one day; temporary failures are retried rather than indexed as permanent absence. Runtime resolution is bounded to six active lookups with an 18-item FIFO queue, an 8s queue limit and 10s complete upstream deadline. Browser work is bounded to three requests. Successful metadata is shared across duplicate queries in a bounded 10-minute/8MB cache; errors are not cached. HTTP/API overload honors Retry-After and per-host cooldowns, including Commons search-busy responses. Diagnostics show strategies, candidate/rejection counts, source/dimensions/licence/confidence and specific safe provider errors.

### Measured coverage

The fixed proximity sample contains 200 venues: 35 accepted real-photo matches (17.5%), 164 unresolved, and one retryable Commons search-busy failure after bounded retries. All 35 accepted images decoded in an actual deployed browser through the image optimizer. The fourteen supplemental images also decoded, giving 49 decoded photos across 216 indexed venues. The same 24-venue baseline improves from 5 to 8 matches. A separate, intentionally targeted direct-media sample found 14 photos across 16 venues (ten Archive photos, two exact Geograph copies, two Commons fallbacks), with two temporary failures. All supplemental queries were normalized to current catalogue identities before indexing. This targeted sample is not blended into the 200-place percentage.

The final measured 200-place sample and unresolved reasons are recorded in `photo-coverage.md` and its data files. This is a photo-independent proximity sample of the existing catalogue with six required venues, not a claim of complete regional coverage or proof that all venues have reusable public photos. Temporary provider failures are reported separately from healthy searches without verified matches. Actual displayed-image checks are distinguished from metadata-only matches.

To refresh a saved sample without losing progress:

```sh
node scripts/enrich-place-photos.mjs \
  --base=https://sidequest-local-discovery.vercel.app \
  --input=docs/photo-coverage-sample.json \
  --output=src/providers/data/place-photo-index.json \
  --concurrency=1 --delay=3500 --batch=25
```

Use `--refresh=true` for a deliberate recheck; public production does not permit bypassing the server photo cache. Inspect/recheck is available in the private Lab. Free services can have gaps and temporary overload; missing images remain labelled honestly rather than being replaced with unrelated venue photos.

## A commercial option if free coverage is insufficient

No paid provider, API key or Supabase dependency was added. Google Places is a potential separate adapter, not an automatic guarantee of a photo for every business. It needs an enabled billing account, a restricted server key, venue/branch matching and author attribution. Google's policies affect the current Leaflet map: Places content shown on a map must be on a Google Map, while content shown without one requires Google attribution. This must be reviewed before any integration; it is not a drop-in source for the current map.

The official international pricing table checked 8 October 2026 lists Photos (New) with 1,000 free monthly requests and then US$7 per 1,000 in the first billable tier; Nearby Search Pro and Text Search Pro each 5,000 free monthly requests and then US$32 per 1,000; Place Details Essentials 10,000 free requests then US$5 per 1,000. Lookup and photo retrieval are separate requests/SKUs, and selected fields can trigger higher-priced tiers. For example, 10,000 photo requests alone would be about US$63 beyond the free cap, excluding lookup charges and tax. These are illustrative published-rate calculations, not a spend commitment. Quotas, billing alerts and current terms would need configuration first.

Place IDs may be stored indefinitely. Places content has caching restrictions, photo names can expire, and required author attribution must be displayed. Google photo responses must therefore remain separate from the durable reusable Commons image index.

Sources:

- https://developers.google.com/maps/billing-and-pricing/pricing
- https://developers.google.com/maps/documentation/places/web-service/place-photos
- https://developers.google.com/maps/documentation/places/web-service/policies

Free-source coverage limitations are measured and documented; they are not hidden by changing rankings or presenting stock photography as a venue photograph.

## Checks

Lint, TypeScript, 167 unit tests and the production build pass. All 30 local browser flows pass, including weather movement, reduced motion, decoded map geography, food filtering, family ages, photo arrival without camera movement, and the Archive API-to-image/credit path. Deployed sample decoding is recorded separately from local fixture tests.
