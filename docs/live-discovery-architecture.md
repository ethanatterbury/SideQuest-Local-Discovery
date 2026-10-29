# Live discovery and deployment limits

SideQuest searches the selected area as people browse. It does not deploy the national OpenStreetMap extract or ask the browser to download geographic catalogue files.

- The server calls Geoapify using its existing server-only key, with OpenStreetMap / Overpass as the no-key fallback. Country coverage is independent of any imported England file.
- Area URLs use the same rounded coordinates and radius buckets as the server cache. Nearby users can share CDN responses rather than forcing another provider search on every visit. The server cache is bounded to 64 areas; the browser retains recent areas and saved plans.
- Individual venue details and official-site evidence are resolved by stable OSM ID. A requested evidence refresh checks live OSM for an updated name or business identity.
- Existing verified photo URLs and attribution remain available. Other photos resolve on demand from identity-checked official websites and open sources. External image files stay on their original hosts. Next.js image optimization is disabled, so browsing does not create Vercel transformation or image-proxy cache copies. Unknown images never become generic stock photographs or fabricated matches.
- No database, Supabase, image warehouse or additional paid service is required.

## Deployment safeguards

`npm run build` prepares the small approved photo set, removes generated `public/data/venues` files, builds Next.js, then verifies the result. Public assets must remain under 20 MiB, and server traces must exclude national extracts, offline photo-match data, media archives and research output. The first checked local build reduced public files from approximately 580 MiB to 4.7 MiB (4.9 MB).

`.vercelignore` excludes research outputs from deployment uploads, and Next.js tracing independently excludes them from runtime functions. `scripts/vercel-ignore-build.mjs` skips data-only maintenance, workflow, test and documentation commits. Application and photo-policy changes still deploy normally.

Import, enrichment and photograph research workflows are manual-only. Existing source data and tools remain in GitHub; `npm run prepare:catalogue` explicitly generates cells for offline research. It is not part of application preparation, development, tests or production builds.

No existing Vercel deployment is deleted by these changes. Usage already recorded is not erased by reducing future deployments. The exact Vercel usage category must be checked separately from measured build size.
