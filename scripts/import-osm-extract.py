"""Generate the free regional fallback catalogue from Geofabrik OSM extracts.

Requires: pip install osmium
Run: python scripts/import-osm-extract.py
Data: OpenStreetMap contributors, ODbL 1.0; distributed by Geofabrik.
"""
import argparse
import datetime
import json
from pathlib import Path
import urllib.request
import osmium

REGIONS = ("berkshire", "surrey", "hampshire")
KEYS = {"name", "name:en", "leisure", "tourism", "amenity", "sport", "website",
        "contact:website", "addr:city", "addr:town", "addr:county", "addr:street",
        "addr:postcode", "fee", "access", "indoor", "lit", "opening_hours",
        "wikidata", "wikipedia", "image", "wikimedia_commons", "alt_name", "old_name",
        "min_age", "max_age", "playground:toddler",
        "attraction", "amusement_ride", "roller_coaster", "min_height", "max_height",
        "playground:indoor", "playground:soft_play"}
LEISURE = {"playground", "indoor_play", "soft_play", "trampoline_park", "water_park",
           "amusement_ride",
           "park", "garden", "nature_reserve", "sports_centre", "fitness_centre",
           "swimming_pool", "bowling_alley", "escape_game", "miniature_golf"}
TOURISM = {"museum", "gallery", "attraction", "zoo", "theme_park", "aquarium", "viewpoint"}
AMENITY = {"cafe", "restaurant", "ice_cream", "cinema", "theatre", "arts_centre"}

class Venues(osmium.SimpleHandler):
    def __init__(self, records):
        super().__init__()
        self.records = records

    def tags(self, obj):
        t = {tag.k: tag.v for tag in obj.tags if tag.k in KEYS}
        if not (t.get("name") or t.get("name:en")) or t.get("access") in {"private", "no"}:
            return None
        return t if (t.get("leisure") in LEISURE or t.get("tourism") in TOURISM or
                     t.get("amenity") in AMENITY or t.get("sport") in {"climbing", "karting"} or
                     any(t.get(key) not in {None, "", "no", "false", "0"}
                         for key in ("amusement_ride", "roller_coaster"))) else None

    def node(self, obj):
        tags = self.tags(obj)
        if tags and obj.location.valid():
            self.records[f"node-{obj.id}"] = {"type": "node", "id": obj.id,
                "lat": round(obj.location.lat, 7), "lon": round(obj.location.lon, 7), "tags": tags}

    def way(self, obj):
        tags = self.tags(obj)
        if not tags:
            return
        points = [(node.lon, node.lat) for node in obj.nodes if node.location.valid()]
        if points:
            # Same bounding-box centre convention as Overpass's `out center`.
            lng, lat = zip(*points)
            self.records[f"way-{obj.id}"] = {"type": "way", "id": obj.id,
                "lat": round((min(lat) + max(lat)) / 2, 7),
                "lon": round((min(lng) + max(lng)) / 2, 7), "tags": tags}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--work-dir", default="work/osm-import")
    parser.add_argument("--output", default="src/providers/data/regional-osm.json")
    args = parser.parse_args()
    work = Path(args.work_dir)
    work.mkdir(parents=True, exist_ok=True)
    records = {}
    sources = []
    for region in REGIONS:
        url = f"https://download.geofabrik.de/europe/united-kingdom/england/{region}-latest.osm.pbf"
        destination = work / f"{region}.osm.pbf"
        if not destination.exists():
            temporary = destination.with_suffix(".partial")
            request = urllib.request.Request(url, headers={"User-Agent": "SideQuest regional OSM importer/1.0"})
            with urllib.request.urlopen(request, timeout=120) as source, temporary.open("wb") as target:
                while chunk := source.read(1024 * 1024):
                    target.write(chunk)
            temporary.replace(destination)
        venues = Venues(records)
        # Filter in C++ before Python callbacks; location caching still sees every node.
        processor = osmium.FileProcessor(str(destination)).with_locations("flex_mem")
        processor = processor.with_filter(osmium.filter.KeyFilter(
            "leisure", "tourism", "amenity", "sport", "amusement_ride", "roller_coaster"))
        for obj in processor:
            if obj.is_node():
                venues.node(obj)
            elif obj.is_way():
                venues.way(obj)
        sources.append(url)
        print(f"{region}: {len(records)} named venues imported", flush=True)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "sources": sources, "copyright": "OpenStreetMap contributors, ODbL 1.0",
        "elements": list(records.values())}, ensure_ascii=False, separators=(",", ":")))
    print(f"Saved {len(records)} venues to {output}", flush=True)

if __name__ == "__main__":
    main()
