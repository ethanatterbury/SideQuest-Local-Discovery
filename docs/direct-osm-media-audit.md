# Direct OSM media audit — 8 October 2026

**Archive is a verified free-source gap in the Commons-only resolver.** All 14 exact OSM Archive image filenames are present in the album's metadata. Album creator is Paul Williams (Paul The Archivist); explicit licence is [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The album describes the unedited Windsor photos as taken mainly for OpenStreetMap mapping purposes.

Source: [Album](https://archive.org/details/windsor-2018-09-15), [public JSON metadata](https://archive.org/metadata/windsor-2018-09-15?output=json). Full evidence and exact OSM refs are in `direct-osm-media-audit.json`. These are research evidence, not a manually assigned product mapping.

## Direct image delivery verified

| Exact OSM subject | Exact album file | Original size | Verified dimensions | Delivery |
| --- | --- | --- | --- | --- |
| Crooked House of Windsor, osm-way-144044029 | Windsor 2018-09-15/DSCN7562.JPG | 4,244,863 bytes | 4608×3456 | archive.org/download URL redirects to dn721902.ca.archive.org/0/items/...; HTTP206, image/jpeg |
| Nando's Windsor, osm-way-144154149 | Windsor 2018-09-15/DSCN7601.JPG | 4,256,742 bytes | 4608×3456 | Same Archive mirror; HTTP206, image/jpeg |

Both dimensions were parsed from JPEG SOF in a 128 KiB HTTP Range response. Archive metadata itself has original format/size/rotation/checksums but no width/height. Other 12 files' dimensions were not individually checked. Three OSM-bound files (Dr Chocs, The Crown Café, Meat at the Parish) carry Archive rotation=90; image presentation must honor orientation rather than assume all originals display as landscape. All 14 exact filenames exist and are JPEG originals.

The other OSM-bound subjects are PizzaExpress, Dr Chocs, The Crown Café, Prezzo, Zizzi, Clarence Brasserie & Tea Room, 1423 China Kitchen, Funkywood, Enzo's, Georgian House, Meat at the Parish and Esquires Coffee. OSM's explicit image field is the subject binding; DSCN generic filenames do not invalidate that evidence.

An automatic adapter can parse OSM Archive details/download references, verify exact item/file inventory membership and reusable album licence/creator, construct the canonical download URL, validate MIME/dimensions and bound downloads, and retain licence/source/credit. Safe URLs should restrict Archive paths and validate any archive.org mirror redirect. A dated 2018 album may show old business names; retain photo provenance. No human venue filename or hardcoded file table is needed.

## Geograph references contribute two licensed files

Exact Geograph ID search in Commons API found:

- [Blue pillar box, Windsor — 403630](https://commons.wikimedia.org/wiki/File:Blue_pillar_box,_Windsor_-_geograph.org.uk_-_403630.jpg ): 339×640 JPEG, CC BY-SA 2.0, Peter Tarleton. Object coordinates 51.48101,-0.6058; OSM Blue Airmail Pillar Box at 51.481109,-0.6056771. Portrait format requires portrait support.
- [Eton College Swimming Pool — 7883745](https://commons.wikimedia.org/wiki/File:Eton_College_Swimming_Pool_-_geograph.org.uk_-_7883745.jpg): 1024×768 JPEG, CC BY-SA 2.0, Matthew Chadwick. Object 51.49586985,-0.61172469; OSM Athens at 51.4959013,-0.6115017. The OSM feature is leisure=sports_centre,sport=swimming, so the swimming-pool image is consistent despite the short name “Athens”.

This supports automatic exact Geograph-ID→Commons resolution without inventing a venue filename match. The direct Geograph pages failed connector retrieval; direct Geograph image delivery was not verified.

## GitHub reference remains unverified

Clara's Cocina Cafe points to raw.githubusercontent.com/lewisevans2007/OSM_Images/main/images/2023/9/3/15.34.58.jpeg. Public repo contents API, raw LICENSE and raw README.md returned 404; the raw image scrape failed. No reusable licence was established. Do not whitelist arbitrary GitHub photos based on the OSM image tag alone.

## Execution

Read-only public source requests; no engine edits, commits, deployments, authentication, copied full photos or commercial providers. Initial source requests encountered connector Internal errors; Archive JSON retry succeeded. One usable public-only VM performed sample binary header checks and was stopped successfully after evidence export.

