"""Behavior checks for the one-time OSM media refresh utility."""
import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "refresh-osm-media.py"


class RefreshUtilityTests(unittest.TestCase):
    def test_refresh_utility_is_available(self):
        self.assertTrue(SCRIPT.is_file(), "The resumable media refresh utility is missing")


@unittest.skipUnless(SCRIPT.is_file(), "Refresh utility has not been implemented yet")
class MediaRefreshTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("refresh_osm_media", SCRIPT)
        cls.media = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.media)

    def test_batches_request_at_most_200_same_type_existing_ids(self):
        elements = [{"type": "node", "id": i} for i in range(1, 402)]
        elements += [{"type": "way", "id": 9}, {"type": "node", "id": 1}]
        batches = self.media.make_batches(elements)
        self.assertEqual([len(ids) for _, ids in batches], [200, 200, 1, 1])
        self.assertEqual(batches[-1], ("way", [9]))
        self.assertEqual(len({i for kind, ids in batches if kind == "node" for i in ids}), 401)

    def test_response_only_keeps_requested_media_and_name_metadata(self):
        response = {"elements": [
            {"type": "node", "id": 1, "lat": 99, "tags": {
                "image": "File:Place.jpg", "alt_name": "Old place", "name": "Changed name",
                "access": "private", "wikidata": "Q1", "wikipedia": "en:Place", "name:en": "Place",
            }},
            {"type": "node", "id": 2, "tags": {"image": "File:Unrequested.jpg"}},
            {"type": "way", "id": 1, "tags": {"image": "File:Wrong type.jpg"}},
        ]}
        self.assertEqual(self.media.metadata_from_response(response, "node", [1]), {
            "node-1": {"image": "File:Place.jpg", "alt_name": "Old place", "wikidata": "Q1",
                       "wikipedia": "en:Place", "name:en": "Place"},
        })

    def test_missing_or_failed_reads_cannot_remove_existing_positive_metadata(self):
        accumulated = {"entries": {"node-1": {"image": "File:Existing.jpg", "old_name": "Old"}}}
        self.media.accumulate(accumulated, {"node-1": {"wikimedia_commons": "Category:Place"}})
        self.media.accumulate(accumulated, {"node-1": {}})
        self.assertEqual(accumulated["entries"]["node-1"], {
            "image": "File:Existing.jpg", "old_name": "Old", "wikimedia_commons": "Category:Place",
        })

    def test_snapshot_merge_preserves_geometry_generated_date_and_venue_fields(self):
        snapshot = {"generatedAt": "original-date", "copyright": "OSM", "elements": [
            {"type": "node", "id": 1, "lat": 51.5, "lon": -0.1,
             "tags": {"name": "Place", "leisure": "park", "image": "File:Existing.jpg"}},
        ]}
        original = repr(snapshot)
        updated = self.media.apply_metadata(snapshot, {
            "mediaUpdatedAt": "refresh-date", "mediaSource": self.media.API_ROOT,
            "entries": {"node-1": {"alt_name": "Other place", "leisure": "private"}},
        })
        self.assertEqual(repr(snapshot), original)
        self.assertEqual(updated["generatedAt"], "original-date")
        self.assertEqual(updated["elements"][0]["lat"], 51.5)
        self.assertEqual(updated["elements"][0]["lon"], -0.1)
        self.assertEqual(updated["elements"][0]["tags"], {
            "name": "Place", "leisure": "park", "image": "File:Existing.jpg", "alt_name": "Other place",
        })
        self.assertEqual(updated["mediaUpdatedAt"], "refresh-date")

    def test_invalid_bulk_response_is_a_failure_rather_than_successful_empty_refresh(self):
        for response in [{}, {"elements": "broken"}]:
            with self.assertRaises(ValueError):
                self.media.metadata_from_response(response, "node", [1])


if __name__ == "__main__":
    unittest.main()
