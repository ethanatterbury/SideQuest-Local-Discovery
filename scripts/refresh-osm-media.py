"""One-time, resumable OSM media metadata refresh for existing snapshot IDs.

python3 scripts/refresh-osm-media.py --offset 0 --batches 2
Offsets count batches, not venues. Output is a compact metadata delta; use
--snapshot-output PATH to merge it into a copy of the original snapshot.
Never use this utility as a per-client discovery or image-fetch endpoint.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import datetime
import json
from pathlib import Path
import urllib.request


API_ROOT = "https://api.openstreetmap.org/api/0.6"
MEDIA_KEYS = frozenset({"image", "wikimedia_commons", "alt_name", "old_name",
                        "name:en", "wikidata", "wikipedia"})


def make_batches(elements, size=200):
    if not 1 <= size <= 200:
        raise ValueError("Batch size must be between 1 and 200")
    batches = []
    for kind in ("node", "way"):
        ids = sorted({e["id"] for e in elements if e.get("type") == kind
                      and type(e.get("id")) is int and e["id"] > 0})
        batches.extend((kind, ids[start:start + size]) for start in range(0, len(ids), size))
    return batches


def metadata_from_response(response, kind, ids):
    if not isinstance(response, dict) or not isinstance(response.get("elements"), list):
        raise ValueError("Invalid OSM bulk JSON response")
    requested = set(ids)
    records = {}
    for element in response["elements"]:
        if not isinstance(element, dict) or element.get("type") != kind or element.get("id") not in requested:
            continue
        tags = element.get("tags", {})
        if not isinstance(tags, dict):
            raise ValueError("Invalid OSM tag dictionary")
        metadata = {key: value for key, value in tags.items() if key in MEDIA_KEYS
                    and isinstance(value, str) and value.strip() and len(value) <= 2048}
        if metadata:
            records[f"{kind}-{element['id']}"] = metadata
    return records


def fetch_batch(kind, ids):
    url = f"{API_ROOT}/{kind}s.json?{kind}s=" + ",".join(map(str, ids))
    request = urllib.request.Request(url, headers={
        "Accept": "application/json",
        "User-Agent": "SideQuest one-time OSM media metadata refresh/1.0",
    })
    with urllib.request.urlopen(request, timeout=20) as response:
        return metadata_from_response(json.load(response), kind, ids)


def accumulate(output, records):
    entries = output.setdefault("entries", {})
    for key, tags in records.items():
        retained = {name: value for name, value in tags.items() if name in MEDIA_KEYS
                    and isinstance(value, str) and value.strip()}
        if retained:
            entries.setdefault(key, {}).update(retained)


def apply_metadata(snapshot, output):
    updated = {**snapshot, "elements": []}
    for original in snapshot["elements"]:
        key = f"{original['type']}-{original['id']}"
        tags = dict(original.get("tags", {}))
        tags.update({name: value for name, value in output.get("entries", {}).get(key, {}).items()
                     if name in MEDIA_KEYS and isinstance(value, str) and value.strip()})
        updated["elements"].append({**original, "tags": tags})
    for key in ("mediaUpdatedAt", "mediaSource"):
        if key in output:
            updated[key] = output[key]
    return updated


def save_json(destination, data):
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + ".partial")
    temporary.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    temporary.replace(destination)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default="src/providers/data/regional-osm.json")
    parser.add_argument("--output", default="work/osm-media.json")
    parser.add_argument("--offset", type=int, default=0, help="Zero-based batch index")
    parser.add_argument("--batches", type=int, default=2, help="Maximum requests this invocation")
    parser.add_argument("--batch-size", type=int, default=200)
    parser.add_argument("--snapshot-output", help="Optional refreshed snapshot copy")
    parser.add_argument("--apply-only", action="store_true", help="Merge saved output without requesting OSM")
    args = parser.parse_args()
    if args.offset < 0 or args.batches < 1 or not 1 <= args.batch_size <= 200:
        parser.error("offset >= 0, batches >= 1 and batch-size between 1 and 200 are required")
    snapshot = json.loads(Path(args.input).read_text())
    batches = make_batches(snapshot["elements"], args.batch_size)
    path = Path(args.output)
    output = json.loads(path.read_text()) if path.exists() else {"entries": {}, "completedBatches": [], "failedBatches": {}}
    if "entries" not in output:
        parser.error("Output path contains a snapshot rather than media accumulation")
    if output.get("batchSize", args.batch_size) != args.batch_size:
        parser.error("Use the same batch-size when resuming")
    output.update({"generatedAt": snapshot.get("generatedAt"), "mediaSource": API_ROOT,
                   "batchSize": args.batch_size, "totalBatches": len(batches)})
    successful = 0
    if not args.apply_only:
        selected = range(args.offset, min(len(batches), args.offset + args.batches))
        completed = set(output.get("completedBatches", []))
        with ThreadPoolExecutor(max_workers=2) as executor:
            requests = {executor.submit(fetch_batch, *batches[i]): i for i in selected if i not in completed}
            for future in as_completed(requests):
                index = requests[future]
                try:
                    accumulate(output, future.result())
                    completed.add(index)
                    output.setdefault("failedBatches", {}).pop(str(index), None)
                    output["mediaUpdatedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
                    successful += 1
                except Exception as error:
                    output.setdefault("failedBatches", {})[str(index)] = str(error)[:240]
                output["completedBatches"] = sorted(completed)
                save_json(path, output)
    output["nextOffset"] = min(len(batches), args.offset + args.batches)
    save_json(path, output)
    if args.snapshot_output:
        save_json(args.snapshot_output, apply_metadata(snapshot, output))
    print(json.dumps({"successfulBatches": successful, "completedBatches": len(output.get("completedBatches", [])),
                      "failedBatches": output.get("failedBatches", {}), "nextOffset": output["nextOffset"],
                      "totalBatches": len(batches), "metadataRecords": len(output["entries"]), "output": str(path)},
                     separators=(",", ":")))


if __name__ == "__main__":
    main()
