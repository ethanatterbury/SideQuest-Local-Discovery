# Free place data

`src/providers/data/regional-osm.json` contains an automatically filtered snapshot of 7,182 named OpenStreetMap nodes and ways in Berkshire, Surrey and Hampshire. Imported 8 October 2026 from the Geofabrik latest regional PBF extracts listed in its `sources` field. The snapshot is a fallback, not a claim that venue details have been verified or are current.

© OpenStreetMap contributors. The database is available under the [Open Database Licence 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Source and attribution: [OpenStreetMap copyright](https://www.openstreetmap.org/copyright), [Geofabrik England extracts](https://download.geofabrik.de/europe/united-kingdom/england.html). The source snapshot remains available in the repository; returned place records preserve attribution in their notes.

Rebuild automatically with Python 3.10+ and `osmium` installed:

```sh
python scripts/import-osm-extract.py
```

The importer filters named visitor categories, rejects private/no-access records, retains mapped websites and Wikipedia/Wikidata hints, and calculates way bounding-box centres. Node and way IDs remain stable. OSM relations are supplied by live discovery; this snapshot contains nodes and ways only. Importing never assigns photographs manually.

Regional requests return up to 300 nearby records immediately, retaining category diversity. Next.js `after()` refreshes from the free Private.coffee and VK Maps Overpass instances after the response; area caches and in-flight deduplication bound repeat work. Outside the snapshot area, discovery uses the same live adapters and retains cached data on failure. Public services do not provide guaranteed capacity.
