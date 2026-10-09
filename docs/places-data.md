# Free place data

`src/providers/data/regional-osm.json` contains an automatically filtered snapshot of 7,182 named OpenStreetMap nodes and ways in Berkshire, Surrey and Hampshire. Imported 8 October 2026 from the Geofabrik latest regional PBF extracts listed in its `sources` field. The snapshot is a fallback, not a claim that venue details have been verified or are current.

© OpenStreetMap contributors. The database is available under the [Open Database Licence 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Source and attribution: [OpenStreetMap copyright](https://www.openstreetmap.org/copyright), [Geofabrik England extracts](https://download.geofabrik.de/europe/united-kingdom/england.html). The source snapshot remains available in the repository; returned place records preserve attribution in their notes.

Rebuild automatically with Python 3.10+ and `osmium` installed:

```sh
python scripts/import-osm-extract.py
```

The importer filters named visitor categories, rejects private/no-access records, retains mapped websites and Wikipedia/Wikidata hints, and calculates way bounding-box centres. Node and way IDs remain stable. OSM relations are supplied by live discovery; this snapshot contains nodes and ways only. Importing never assigns photographs manually.

Builds normalize the existing source snapshot into 27 geographic cells (7,180 venue records after ancillary-facility filtering at V2 migration). Clients load only intersecting cells, reuse a bounded IndexedDB area archive and request an explicit bounded live refresh. The API shares canonical geographic cache keys and category-balanced candidates; discovery ranks the eligible travel area rather than choosing the nearest 300 regardless of type.

For another UK region, use `--regions england/greater-london`, `--regions scotland` or `--pbf /path/to/existing.pbf`. `--max-download-mb 400` caps download size. Put prepared extracts in `src/providers/data/regions/` and run `npm run prepare:data` to shard them. `.github/workflows/venue-data.yml` is an opt-in 20-minute import job producing a seven-day artifact; it does not publish data or deploy. Nationwide precomputed coverage has not been generated in this task. Public Overpass services remain best effort, with one shared four-second live deadline and graceful cached fallback.
