# Geograph metadata candidates

SideQuest matches the free daily [Geograph metadata dumps](https://data.geograph.org.uk/dumps/) to prepared default activity venues. This adds a discovery source for venues without their own website. The output is **candidate metadata**, not approved photographs or a photo coverage claim.

The importer downloads only `gridimage_base.tsv.gz`, `gridimage_geo.tsv.gz`, and their small `.schema` files from the fixed official dump host. It makes no live Geograph API calls, scrapes no photo pages, and downloads no image files. Geograph explicitly requires permission for direct image hotlinking. The separate photograph workflow resolves each exact Geograph ID to a licensed Wikimedia Commons mirror, inspects the photograph and reuse metadata, and uses allowed Wikimedia delivery URLs.

The [primary column specification](https://data.geograph.org.uk/dumps/columns.html) documents the exact order and types. The base table contains image ID, contributor ID, attribution name, title, moderation status, taken date, coarse grid reference, internal x/y, **subject** WGS84 latitude/longitude, and reference system. The geo table adds subject national coordinates and `natgrlen`, photographer coordinates/direction, and `use6fig`. Photographer coordinates are never used as venue evidence. `use6fig` restricts precision even where finer coordinates are present, so any nonzero value causes abstention.

The headerless MySQL TSV format escapes embedded tabs and newlines as `\t` and `\n`. The importer splits rows before unescaping fields and validates the downloaded schema before reading the dumps. UTF-8 is the default transport encoding; `--encoding=latin-1` is available for an explicitly verified legacy export. The SQL storage charset alone does not establish the export encoding. Invalid encoding fails closed.

Only prepared places without `optionalCategory` participate. A small spatial grid indexes venues, then each streamed base row checks nearby names. A candidate requires a distinctive full normalized venue name, a unique matching venue within 150 metres of the subject, an unrestricted subject location with at least eight grid digits (10 metres), and nonzero subject national coordinates. Generic names, ambiguous nearby targets, coarse positions, and titles describing roads, parking, approaches, signs, nearby locations or views from a venue are rejected. Full-name matching is conservative evidence; it does not prove the photographed subject or current venue condition.

At most three candidates per venue survive, ordered by newest taken date, finer subject precision, shortest distance, then photo ID. Future and impossible dates are excluded. The original date is preserved, including the source's documented unknown month/day values. Downstream photograph approval must apply its own age and visual checks.

The compressed output `src/providers/data/geograph-venue-matches.json.gz` retains query identity, Geograph ID/title, photographer and contributor ID, taken date, subject position and precision, source page, license, match distance/name evidence, and SHA-256/byte counts of both source dumps. It contains no image URL. JSON ordering and gzip timestamps are deterministic for fixed inputs.

Run with prepared venue data:

```sh
npm ci --ignore-scripts
npm run prepare:data
python -m unittest discover -s tests -p test_geograph_venue_matches.py -v
python scripts/import-geograph-venue-matches.py --download --work-dir work/geograph
```

Existing local gzip TSV files can be passed with `--base-tsv` and `--geo-tsv`. Downloads are capped at 512 MiB per file and 1 GiB total by default. Each streamed decompressed file is capped at 4 GiB, 12 million rows, and 64 KiB per row. Only name/spatial matches enter temporary SQLite storage, capped at 256 MiB and 250,000 candidate IDs. Complete downloads can be reused on a local rerun; interrupted partials are removed. Output is replaced atomically only after successful validation. Million-row progress logs and final counts report timing and candidate totals.

The weekly/manual/scoped-main GitHub workflow prepares data with read-only repository permissions and a 30-minute timeout. A separate publisher can write only the compressed candidate artifact. It checks for changed catalogue sources, normalization, importer, workflow, dependencies or candidate output, then uses a normal fast-forward push. Independent UI and photo work can advance while preparation runs.

`Maintain Geograph venue photographs` starts after a successful metadata workflow, hourly, or manually. The explicit `workflow_run` trigger is necessary because a metadata commit made with `GITHUB_TOKEN` does not itself trigger another push workflow. Both photograph workflows share one concurrency group through publication so they cannot overwrite the same manifest concurrently.

`prepare-geograph-photos.mjs` checks at most 1,000 venues in 20 minutes, saving each outcome before continuing. The Commons resolver looks up P7384 and exact Geograph source links, checks conflicting source IDs, and requires a known open license, photographer credit and Wikimedia CDN URL. Venue matching independently requires the imported full-name and precise subject-position evidence; source identity alone never establishes the venue. Photos older than ten years and clearly unsuitable subject descriptions are excluded.

The isolated pinned CPU model from the official-site pipeline classifies eligible images against the same nine fixed scene and rejection prompts, requiring a score of at least 0.8 and a margin of 0.5. Original bytes and decoded pixels remain in RAM; only a hash, dimensions and model scores are checkpointed with the image URL and source evidence. This is scene classification, not a personal visual review or proof of venue identity. Uncertain images remain unresolved. No paid inference or search API is used.

The shared browser gate requires each new photo to decode on the real venue detail page with the exact source, photographer and license links. Failed new photos are quarantined; existing approved photos are retained. Unchanged passing delivery evidence is reusable for 30 days and its timestamp is not renewed by a metadata refresh. Preparation has read-only GitHub access; a separate publisher stages only the resulting URL manifest and uses a guarded fast-forward push. Prepared 960-pixel Geograph images load directly from Wikimedia rather than consuming another Vercel image transformation. National candidate and delivered-photo counts must be measured from the real runs; passing fixtures do not establish coverage.

Geograph Project metadata is licensed [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/), with individual photographer attribution retained. Prepared OpenStreetMap query identities retain attribution to OpenStreetMap contributors under ODbL 1.0. A Commons mirror's current file metadata remains the authority for image reuse and attribution.
