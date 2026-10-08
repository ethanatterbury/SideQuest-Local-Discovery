# SideQuest

**Stop scrolling. Go somewhere.**

A local-first discovery app that turns a little context into a few considered outings. Built in Next.js App Router, React and strict TypeScript, with original editorial UI, MapLibre and a Leaflet street-map fallback, free live place discovery, automatic credited photography, deterministic ranking and a development Environment Lab.

## Run it

Node 22 or newer (24 recommended). No accounts, API keys, database or Supabase project required.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. The first starting point is Sandhurst. Change it in the header, use device location explicitly, search a town, or enter `latitude, longitude`. Browser geolocation requires HTTPS or localhost. Location denial keeps the town picker usable.

Optional settings are in `.env.example`; unset defaults already work. Copy it to `.env.local` only if changing settings. Production:

```sh
npm run check
npm start
```

## What is built

- Discover with optional company, time, travel, money, environment and walking/driving refinement. Three focused recommendations; Explore loads twelve ideas at a time with more available. Family refinement includes optional children’s ages and outing types such as soft play, playgrounds, museums and animals.
- Get me out of the house and context-filtered Surprise Me. Novelty changes the score rather than randomly selecting unsuitable places. Roll another cycles through eligible options without repetition.
- Build my afternoon: door-to-door itinerary, nearby compatible stops, return travel, daylight, opening windows, budget and optional food-break allowance. Regenerate, shorten, cheapen, increase novelty, delay, save and share.
- Map with clustered vector points, selection-linked results, saved/visited indicators, travel radius, estimated links, explicit search-this-area action, mobile sheet, card swipe and restrained weather overlays. Browsers without WebGL use Leaflet and OpenStreetMap street tiles. If both map services fail, a coordinate overview and accessible result list remain available.
- Thirty curated places remain available offline, supplemented by up to 300 nearby OpenStreetMap venues per query and an archive of recent areas. Ten licensed local photos remain packaged; visible places without imagery automatically request a matching Wikimedia photo. Missing or uncertain matches retain honest placeholders. Public detail pages include practical uncertainty, official sources, alternatives, collections, reactions, notes, directions and share URLs.
- Saved library, custom collections, visual visit history and estimate-based travel statistics. No account wall.
- PWA manifest, ownable forked-route mark, maskable and iOS icons, offline shell, cached assets, saved/history access and install guidance.
- Private Environment Lab, normalized providers, analytics event boundary, automated domain and browser tests, CI and visual matrix tooling.

## Environment Lab

Run development and visit **`/dev/environment`**. A discreet flask link is in the footer. All changes override a single environment context and persist in this tab's session; reset returns to live settings. Use Open SideQuest to test the full application under the same conditions.

Weather: live, clear, sunny, partly cloudy, overcast, light/heavy rain, thunderstorm, fog, snow, heat, high wind. Time: live, sunrise, morning, midday, golden hour, sunset, evening, midnight. Temperature, precipitation, wind and visibility sliders affect both presentation and ranking. Preset towns and custom coordinates, device previews, reduced motion, scoring details and failure toggles are included. Use Test location request for denied/timeout states.

Failures: weather, geolocation denial, geolocation timeout, map, places, no recommendations and offline. The offline switch simulates the environment; test actual service-worker caching by disconnecting the browser separately.

**Production returns 404 for the Lab**, and hides its entry point. For a private Vercel preview only, set `NEXT_PUBLIC_ENABLE_ENVIRONMENT_LAB=true` at build time. Turn it off for public production. Preview device states constrain the panel width and use container queries; Playwright viewports verify actual browser sizes.

## Quality checks

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run test:visual
```

For the real offline check, run `npm run build` and `npm start -- --port 3001` in one terminal, then `npm run test:offline` in another. It checks the production Lab guard, install manifest, saved/history access after disconnecting and uncached navigation recovery. `TEST_BASE_URL` can target a different production server.

`npm run check` combines lint, types, unit tests and production build. Browser tests start development automatically unless a server is running. On a fresh computer, first run `npx playwright install chromium`; an installed `/usr/bin/chromium` or `CHROMIUM_PATH` is also supported. `TEST_BASE_URL` targets an already-running server. Visual captures need the development server running and save under `work/visual-matrix`.

Domain tests cover severe weather and night exclusions, closing after arrival, DST, budgets, round-trip time, geographic constraints, scoring, negative feedback, language parsing, external weather validation, storage failures and data recovery. Browser flows cover reveal, save/reload, collections, reactions, itinerary save, denial fallback, Lab, bad URLs, narrow-phone focus and map selection. The vector-map smoke test uses a local style fixture to isolate map behavior from the external tile service; it does not validate that service's availability.

### Visual test matrix

| Conditions | Review |
| --- | --- |
| Clear / midday | Outdoors rise; readable warm atmosphere |
| Clear / golden hour | Warm map; sufficient daylight required |
| Clear / night | Dark map paint; daylight-only places excluded |
| Overcast / midday | Cooler light; controls retain contrast |
| Light rain / daytime | Shelter rises; sparse particles on map |
| Heavy rain / night | Indoor ideas; dark, restrained atmosphere |
| Fog / morning | Exposed viewpoints excluded; sharp labels |
| Snow / evening | Sparse particles; daylight limits |
| Reduced motion / rain | No particles or animated transitions |
| Map unavailable | Coordinate overview, selection and results |
| Weather unavailable | Explicit uncertainty; discovery continues |
| Location denied / timeout | Town picker remains usable |
| Offline | Cached shell and local library |

Viewport matrix: 320×568, 390×844, 430×932, 360×780, 844×390, 768×1024, 1024×768, 1366×768, 1440×900, 2560×1440 and 820×900. Check scroll overflow, reachable buttons, modal focus/escape, image loading, sheet containment and navigation. Environment screenshots intentionally simulate map failure where the external provider cannot be reached.

## Architecture

- `src/domain`: portable normalized models and pure discovery, timing, itinerary and environment functions.
- `src/providers`: curated and live OpenStreetMap places, Wikimedia photography, Open-Meteo weather, geocoding, estimated routing, safe persistence and optional analytics.
- `src/components`: environment/local-state boundaries, semantic dialog primitives, location picker and responsive shell.
- `src/features`: discover, place, itinerary, map, saved/history and Lab.
- `src/app`: server layouts, metadata, route shells, static public place pages, manifest and OpenGraph image.
- `public`: locally packaged imagery, credited in `docs/image-credits.md`, icons and service worker.

The UI consumes internal models, not provider API payloads. `PlacesProvider`, `WeatherProvider`, `RoutingProvider`, `GeocodingProvider`, `PreferenceStore`, `SavedPlacesStore`, `HistoryStore`, `CollectionStore` and `AnalyticsProvider` are replacement boundaries. Image references are normalized on `Place.image`. MapLibre stays behind the lazy map feature boundary. The client feature components are interactive; route pages, metadata and the outer document are server components. No map runtime is loaded on the discovery route.

### Recommendation score

Hard exclusions precede scoring: travel, minimum visit plus return journey, known budget, free-entry uncertainty, environmental preference, daylight, dangerous conditions, known closure and explicit dismissals. Ranking then weighs weather 20, distance 18, time 15, opening 12, intent 15, money 9, company 6, novelty 8 (14 for surprise), positive history 3 and season 3. The score normalizes against 109 available points (115 in surprise). Negative feedback and recent visits subtract points. Unknown weather and hours receive conservative partial points, with explicit explanations. The Lab displays signal points; its sum is normalized for the public match percentage. Scores are comparative editorial recommendations, not calibrated probabilities.

### Data and factual limits

The launch dataset contains real places and editorial durations/suitability. Nearby venue expansion uses the free Overpass API with two mirrors, bounded category-balanced queries and caching. Public service capacity and regional coverage vary; failure retains curated and cached places. Live events are not claimed. Most venue prices and hours remain unknown, so check links before going. Children’s ages exclude explicitly tagged age limits; unverified suitability remains labelled as needing a venue check. FAST museum's regular Saturday/Sunday 10am–4pm schedule was checked against its official site on 7 October 2026; holidays need separate checking. Other factual details are deliberately conservative and need ongoing editorial verification. Free entry excludes parking, food and optional activities.

Travel estimates use haversine distance, a road-distance allowance, typical speed and five-minute rounding. Map lines connect coordinates and are **not road routes**; directions open Apple or Google Maps. A food stop reserves time and an allowance rather than inventing a venue or reservation. Unknown ticket prices make the itinerary budget explicitly unverified. Budgets and food allowances are per person.

Weather uses Open-Meteo's current and hourly/daily forecast, validates core fields and dates, aborts at eight seconds, caches successful coordinates for 15 minutes and refreshes in-session. Failed weather remains unavailable, or uses a labelled cached value. Fallback daylight is conservatively 08:00–16:00 London time, rather than a claimed astronomical calculation. Seasonal metadata can be attached to curated places; there are no fabricated seasonal events. API requests send the selected coordinates to the chosen weather service; local persistence does not save device movement traces.

## Vercel

Import `ethanatterbury/SideQuest-Local-Discovery` as a Next.js project. Root directory: repository root. Install: `npm ci`. Build: `npm run build`. Use Node 24. Set `NEXT_PUBLIC_SITE_URL` to the deployment origin for absolute metadata. No database integration is necessary. The Lab flag is optional for private preview builds. Map/weather APIs are requested by the browser and require those public services to be reachable; failures degrade safely.

### Automatic photos

The server looks up Wikidata, Wikipedia and Wikimedia Commons using the venue name and coordinates. A photo must match the subject and location, have usable landscape dimensions and an accepted reuse licence. Responses include source, author and licence credits. Lookups have deadlines, concurrency limits and positive/negative caches; verified results persist with the browser’s place archive. The image optimizer accepts only Wikimedia Commons uploads. No Google Places key, paid image search or manually maintained per-venue photo mapping is required. Free Wikimedia coverage cannot supply a verified photo for every commercial venue.

### Production Upgrade Options

- Review the hosted Open-Meteo API's commercial-use terms and throughput for a public commercial deployment; use an appropriate plan or compliant replacement. Its normalized adapter is isolated.
- OpenFreeMap is the no-key development vector default. For predictable production capacity use a contracted vector provider or self-host a licensed style/tiles, supplying `NEXT_PUBLIC_MAP_STYLE`. Retain attribution and compatible glyph/sprite sources.
- Add a verified routing adapter for actual road/time/traffic data. Estimated links remain visibly distinct until configured.
- For further coverage, extend the existing normalized OpenStreetMap places and Wikimedia image providers with an appropriate source/licence review. Verify admission, opening schedules, accessibility and imagery routinely. An account-backed image store is optional, not required.
- Optional analytics plugs into the no-op provider. Collect only needed events with consent appropriate to the chosen provider; no third-party analytics is installed.

### Future cloud migration

Local state is a versioned browser JSON document. Replace the persistence interfaces with an asynchronous repository behind the context, add explicit sign-in/sync consent, stable collection and visit IDs, migration and conflict handling. Import existing local selections only after the user asks to sync. PostgreSQL, an auth provider and an image service can be added then. Supabase could be one future option; **no Supabase code, credentials, dependencies or projects are used in this version**. Keep precise location out of account history unless a future feature explicitly needs it.

## Design and plugin provenance

The build follows `PRODUCT.md`, `DESIGN.md` and the saved design/implementation documents. Superpowers informed planning and test gates; Impeccable and UI UX Designer informed hierarchy, state handling, accessibility and responsive composition; Animation Maker/HyperFrames informed restrained reveal timing and reduced motion; Firecrawl researched official pages and Wikimedia licensing and retrieved licensed source photos.

FLOWSTACK Brick 0.2.2 was discoverable, but its exact-version Agent Knowledge resolver was unavailable in this skill runtime. No undocumented component API is used. The temporary fallback is application-owned semantic HTML, native dialog/select/input and custom tokens/CSS, verified by keyboard, responsive, type and browser checks. Owner: application UI; a future Brick adoption needs the exact package guidance. Impeccable's CLI launcher was also unavailable; its craft guidance was applied directly and artifacts recorded. No HyperFrames video runtime is shipped because this deliverable is an interactive app rather than a rendered video.
