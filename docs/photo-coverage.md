# Actual free-photo coverage audit

The fixed 200 catalogue entries were all attempted. The published index accepts **35/200 (17.5%)** venue photos, records **164 unresolved** queries and **1 retryable** query. Villa Bianca remains retryable after two bounded retries because Commons reported `cirrussearch-too-busy-error`; it is not counted as a completed absence.

The initial run returned 40 matches,147 unresolved and13 transient failures. All 13 transient rows were retried once; a second bounded pass covered the two remaining transient rows. All 40 positive queries were then checked on production `373da70` (resolver SHA256643fec990111c4ddf8e79d56ea199d84a28b730887d68964207a5642a7c91f02). The checkpoint retains all 255 actual attempts, public queries, timestamps and diagnostics.

## Review and delivery

Five previously selected photos were excluded: Camberley Park received a pub on Park Street; Tekels Park received a nearby motorway; Finchampstead Memorial Grounds received its nearby hall without establishing the grounds as subject; Birchwood Reserve received an adjacent path; Starbucks Fleet received an Istanbul tram whose fleet-number category mimicked the town. The final matcher rejected the first three completed mismatch rechecks; Finchampstead's retry resolved negative. The final `373da70` Starbucks response was explicitly quarantined. Subsequent production probes prompted generic inventory/address-context and branch-subject fixes; those changes are covered by regression tests. The stored audit counts are not re-labelled as results from those later changes. One Oak was inspected visually: its photograph shows the whole actual pub with a small plaque on the facade, and is retained.

**All 35 accepted sample photos and all 14 supplemental photos decoded successfully in browser DOM `Image.decode()` through the canonical Next optimizer (1080px, quality 75).** This is image rendering verification, not merely metadata or HTTP availability. Raw dimensions remain in each image record. Sample quality: 27 landscape images at least 1,200px wide, 8 smaller fallbacks, 0 portraits. The 35 entries use 33 unique image URLs; repeated physical places remain in the fixed OSM sample.

## Comparable baseline

Recovered actual old production responses match **5/24 (20.8%)**. The same 24 IDs now have **8/24 (33.3%)**, three additional matches and no lost baseline matches. New matches are Bottom Meadow, Beefeater and Ambarrow Court. The comparison uses the original saved responses, not a rerun or inferred baseline.

## Separate supplemental sources

The index also contains 16 regional venues selected for explicit OSM media references: **14 images, 2 retryable** (10 Archive, 2 direct Geograph-to-Commons, 2 Commons fallbacks). These are outside the 200 sample and do not change its denominator. Production normalization restored aliases and entity metadata after verifying identical id/name/coordinates/direct-media references. All 14 decoded through the browser optimizer.

## Method and limits

The fixed sample in [photo-coverage-sample.json](photo-coverage-sample.json) was chosen independently of photos; no venue-specific photo mapping was added. Serial venue requests used 3-second pacing, bounded provider deadlines and cooldowns. Source stages cover declared Commons media, Wikidata P18/categories/aliases/coordinates, Wikipedia, contextual Commons search, geo/media captions and related categories. All accepted images retain their reusable license, credit, Commons or Archive source, dimensions, strategy and heuristic evidence confidence. Photo availability does not affect place ranking.

Initial attempts 0–62 used exact resolver snapshot 1f2c07a9… ; 63–85 used bf4d7780… (safe error classification/cooldown only). Attempts 86–199 called the real public canonical production API; that URL changed deployments during the audit (2fc4fe44 then42c51c0), so stale hardcoded driver snapshot claims were marked uncertain. All 40 final positive checks explicitly record `373da70`. Later small Fleet/whole-building plaque fixes are owned by the parent and are not misreported as tested here.

Unresolved means these bounded checks found no verified reusable subject photo; it does not establish that no such photo exists anywhere. Licensed photos of many local businesses were not found. Connector/session expiration never became a missing-photo record: checkpoints survived each renewed public VM. No protected credentials were used.

Artifacts: [photo-coverage-attempts.json](photo-coverage-attempts.json) (all attempts); [photo-coverage.json](photo-coverage.json) (counts/provenance/baseline); [photo-coverage-unresolved.json](photo-coverage-unresolved.json) (every unresolved/retryable query and reasons); [photo-coverage-image-delivery.json](photo-coverage-image-delivery.json) and [photo-coverage-supplemental-delivery.json](photo-coverage-supplemental-delivery.json) (actual browser decoding); [../src/providers/data/place-photo-index.json](../src/providers/data/place-photo-index.json) (216 production query identities, 49 accepted images).
