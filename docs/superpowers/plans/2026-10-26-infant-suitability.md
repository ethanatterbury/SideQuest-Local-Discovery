# Infant suitability failure and provider decision

The user reported bowling in recommendations for a child under one, while reiterating the need to rebuild places, photos, matches and the UI. Fix the concrete eligibility bug now; retain the broader provider/UI rebuild objective.

1. Reproduce the real regional bowling record with the actual family query and persisted suitability metadata. Verify Discover ranking, map ranking and planning use the corrected gate.
2. Recompute restriction requirements from category evidence so an old cached `requiresAgeCheck: false` cannot bypass current policy. Bowling and miniature golf require reported child-age guidance.
3. When any child is under one, generic child-play, cinema and general/leisure activity classification is insufficient evidence of an infant activity. Allow normal family visits to nature/culture/animals; admit infant participation only with explicit verified official infant-suitability evidence, preserving other age/access restrictions. Never infer an infant experience from a venue name, photo, changing table, maximum-age-only sentinel or generic family tag.
4. Verify the full unit suite, lint, type checking, production build and focused browser case. Review and publish the bounded bug fix to main under existing authorization.
5. Provide an up-to-date, primary-source comparison of Google, Mapbox, Geoapify, Foursquare and open sources, with billing/photo/storage caveats and simple setup instructions. No paid service is activated by the assistant. A provider change alone does not establish good recommendations or an approved new UI.

## Verification and review

The initial red run reproduced eight failures against the previous infant-eligibility behavior. After the fix and review, 286 unit tests, ESLint, TypeScript and the optimized production build pass. The targeted production-build browser run passes both cases: existing child-age/soft-play persistence and the new older-child bowling → under-one exclusion → reload → map → new plan journey.

Review identified and corrected incidental-playground rejection at ordinary museum/park/aquarium visits. The first browser run also exposed a preference-restoration race: an initially enabled company selector could be changed before hydration/restoration, then overwritten. Refinement controls now wait for the existing provider readiness signal; both browser cases pass with that fix. This does not constitute a complete UI redesign or verification of all other input surfaces.

The current source comparison and account steps are recorded in [the 27 October decision](../../provider-and-product-decision-2026-10-27.md), including the lower-cost Places UI Kit path. No new provider or billing was enabled.
