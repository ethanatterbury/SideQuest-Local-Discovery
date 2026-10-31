# SideQuest outing overhaul implementation plan

**Goal:** Deliver a more useful, clearer discovery and day-planning experience, improve externally hosted photo delivery, and improve weather without reintroducing map freezes.

**Architecture:** Retain Next.js, live area-based Geoapify/OSM discovery, shared evidence-based suitability and direct external images. Isolate photo orchestration, recommendation evidence, discovery UI, day planning and procedural weather so each can be verified independently. User has repeatedly delegated design/engineering decisions and explicitly instructed execution and direct main publication.

**Constraints:** SideQuest only; recruitment website excluded. No paid services, Supabase, bulk national deployment catalogues or photo warehouse. No named venue exceptions. Preserve infant restrictions, real opening/admission uncertainty, keyboard/mobile access and existing map performance budgets. One reviewed application release after verification; no deletion of deployments.

## Tasks

- [x] Photo delivery: reproduce serial-source blocking, race independently verified sources within the existing deadline, retain accurate attribution/identity, cancel unnecessary work, and use verified public identifiers to find missing official websites. Inspect live public responses in multiple English areas. Never relax image identity to fill cards.
- [x] Recommendation evidence: reproduce incidental facility misclassification and unsupported generic-attraction relevance; fix category/evidence precedence while keeping all eligible places and performance.
- [x] Discovery design: inspect incumbent desktop/mobile, build compact search/filter hierarchy and concrete result cards using scoped styles, preserve all functional controls and accessibility.
- [x] Day planner: reproduce over-greedy first-stop allocation and arrival-time candidate omissions; build practical visits with return travel, optional picnic break, opening windows and photos. Expose clear start/settings/adjustment controls.
- [x] Weather: improve light-rain pixel visibility and procedural cloud depth/time-based motion; retain single-pass budget, reduced motion, hidden-tab throttling and map legibility.
- [x] Verify: focused RED→GREEN tests per behavior, then root full lint/type/unit/build checks serially; production-browser flows plus paired desktop/mobile screenshots; one bounded visual correction pass and independent review. Commit and push main, verify Vercel READY and asset budget. Clearly record remaining photo/source gaps.

## Review focus

Mixed venue primary vs incidental experiences; multi-branch photo identity and partial upstream failure; routes crossing opening/daylight boundaries; long names/unknown metadata at mobile widths; repeated context/layer changes under high result counts. No visual ranking bonuses for merely having a photo.

## Initial evidence

Live 8km place responses: Godalming 290 records / 64 official website URLs; Manchester 300 / 100. Among non-optional activities in those responses, only 9/104 around Godalming and 62/121 in Manchester had a mapped official website. A direct live LEGOLAND publisher preview resolved accurately in 849ms, so this is not a universal photo transport failure. Current photo route awaits official preview up to 4s before trying reusable sources; browser allows only three queued venue lookups at once. Missing official sites must be improved independently of the image renderer.

## Verified implementation and review

- Official publisher and reusable-source lookups run independently, return the first verified photograph, and cancel abandoned work without cancelling other consumers. Logos remain identified branding fallbacks. Source URL/attribution metadata is retained; no image warehouse was added. A resolver query namespace bypasses old browser/CDN-cached absences.
- Missing official sites can be resolved through an explicitly mapped Wikidata entity only after exact name/alias identity and nearby Earth coordinates match. Only validated HTTPS P856 URLs are returned. Missing identifiers still limit discovery; no guessed domains or low-quota signup requirement was introduced.
- Dead mapped publisher paths can retry the same origin's homepage after 404/410, with all original venue/location/subject checks preserved. Added standard og:image:url and itemprop image metadata extraction after comparing the public metascraper image rules.
- Primary venue experience now outranks incidental facilities. Unsupported generic attraction defaults get weaker recommendation evidence and cannot advertise an unsupported interest match.
- Planner minimum visits, arrival windows, spare time, asymmetric return-home journeys, per-leg travel limits, infant age editing and optional zero-cost picnic are covered by regressions. Four independent-review findings were fixed; source cancellation includes per-consumer queue and transport cleanup.
- Desktop 1440px and phone 390px captures: Discover and Map scroll widths equal the viewport; map height equals 1000px viewport; planner bounds remain contained. No page errors recorded. Independent visual review disposition: ship. Documentation review found no material mismatch; logo and static-tint qualifications were clarified.
- Full checks: lint/typecheck and 787 unit tests across 66 files passed. Production build and traced photo-runtime boot were verified; public assets remain 4,896,486 bytes / 47 files with zero bundled national venues.
- Browser verification: 57 active flows passed in the full run; five harness expectations/fixtures were updated for the new copy, unified chips, stronger museum eligibility, camera-independent eligibility, and native select accessible naming. All five focused reruns passed, yielding 62 verified active flows. The 103 prepared-publisher download cases remain opt-in and are not evidence of universal live photo coverage.

## Remaining source limits

Live probes verified a LEGOLAND publisher photo, a Godalming Museum reusable photo, and a clearly identified Breakout Manchester logo. A stale Howling Owl path returned 404; its homepage carried conflicting location evidence and remains correctly rejected. These examples are observations, not venue-specific code. Venues without a verified mapped/publisher/reusable source may still lack imagery; universal England-wide photo coverage is not claimed.

Final photo-cache regression passed RED→GREEN; the three photo delivery/retry/credit browser scenarios also passed against the final production build. The application release is published directly from main; its Vercel deployment must reach READY before reporting it live. No deployments were deleted.
