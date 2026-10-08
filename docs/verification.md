# SideQuest live discovery verification

Checked 8 October 2026. ESLint, strict TypeScript, 63 unit/provider tests and the production build pass. All 19 browser flows pass, including pagination, live detail/save/reload, child ages, automatic photo caching, shared-origin catalogue loading and map selection/camera preservation during delayed photo responses. The raster-map browser test disables WebGL, serves fixture street tiles, checks zoom controls, heavy rain, midnight styling and mobile overflow. Fixture tests isolate behavior from public service availability.

The production offline smoke passes for the Lab guard, manifest, saved/history and uncached navigation recovery. A fresh code review found and cleared corrections for shared live afternoons, URL selection and camera movement on photo arrival. Real hosted provider and map verification is recorded separately after deployment.

The original v1 visual matrix and measurements below predate these new live features; they remain historical evidence rather than new performance measurements.

# Original v1 verification

Checked 7 October 2026 against the final implementation.

| Check | Result |
| --- | --- |
| ESLint | Pass |
| Strict TypeScript | Pass |
| Vitest domain/provider suite | 32 tests passed |
| Production build | Pass; 43 prerendered routes, including 30 place pages |
| Playwright critical flows | 11 tests passed |
| Actual production offline smoke | Pass; saved/history, uncached-route recovery, manifest and Lab guard |
| Responsive/environment captures | 28 captures, no horizontal overflow or browser exceptions |

The responsive set covers eleven sizes from 320×568 to 2560×1440, including portrait, landscape, tablet and split-screen. Thirteen map conditions cover daylight, night, golden hour, rain, fog, snow, reduced motion and provider failures. Detail, mobile map and Lab views are also captured. `scripts/visual-matrix.mjs` waits for photographs to decode before capturing the full page.

Browser tests exercise Escape, save/reload, collections, visit reactions/notes, saved afternoons, food/time adjustments retaining the original plan context, shared intent, denied geolocation, development overrides, bad URLs, narrow-phone keyboard focus and map selection. The MapLibre interaction test serves a minimal local vector-style fixture; it verifies the engine, synchronized cards and mobile sheet independently of the external tile host.

The external tile service was inaccessible from this execution environment. Atmospheric screenshots therefore deliberately exercise the labelled coordinate fallback. They do not establish the availability or visual appearance of the hosted production tile service. The app provides a configurable style URL and a failure-safe list; hosted provider terms and production capacity remain deployment considerations described in the README.

An unthrottled local production-browser sample at 390×844 measured about 190 KB of encoded JavaScript on Discover, with cumulative layout shift 0.0103. Place detail and Saved measured zero layout shift. The map canvas is absent from those routes, and the map runtime remains behind its dynamic feature import. These are local observations, not a mobile-network benchmark or a Lighthouse score. Fonts are self-hosted; photographs are local WebP files with fixed dimensions; weather particles are bounded and pause when hidden.

The fresh finish review requested six material corrections: visit duration limits, saved-plan controls, shared intent, WMO/current-hour weather normalization, regional metadata contrast and a redundant detail label. Regression tests reproduced the timing, weather and sharing failures. After one correction batch, the reviewer scored all six resolved, with a `ship` verdict scoped to those fixes.

Impeccable's executable launcher, detector and FORM seed were unavailable through the cloud skill runtime. The build follows the documented code-led direction; no unavailable comp, seed or detector result is claimed. Photographic provenance is recorded in `image-credits.md`.

Run the checks using the commands in the README. Live weather and road routing are different concerns: forecasts use the isolated Open-Meteo adapter; all journey times and map connections remain labelled estimates.
