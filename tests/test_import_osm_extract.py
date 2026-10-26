"""Exercise the real OSM parser with nodes, ways and a multipolygon relation."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

@unittest.skipUnless(importlib.util.find_spec("osmium"), "Install osmium to exercise real extracts")
class ImportTests(unittest.TestCase):
    def test_multipolygon_venue_and_play_metadata_survive_import(self):
        with tempfile.TemporaryDirectory() as folder:
            source, output = Path(folder) / "sample.osm", Path(folder) / "result.json"
            source.write_text('''<osm version="0.6">
<node id="1" lat="51.3" lon="-0.8"/><node id="2" lat="51.3" lon="-0.79"/>
<node id="3" lat="51.31" lon="-0.79"/><node id="4" lat="51.31" lon="-0.8"/>
<node id="5" lat="51.3" lon="-0.8"><tag k="name" v="Independent play cafe"/><tag k="leisure" v="indoor_play"/><tag k="amenity" v="cafe"/></node>
<node id="6" lat="51.3" lon="-0.8"><tag k="name" v="Private park"/><tag k="leisure" v="park"/><tag k="access" v="private"/></node>
<way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="1"/></way>
<relation id="20"><member type="way" ref="10" role="outer"/><tag k="type" v="multipolygon"/><tag k="tourism" v="museum"/><tag k="name" v="Multipolygon museum"/></relation></osm>''')
            subprocess.run([sys.executable, str(ROOT / "scripts/import-osm-extract.py"),
                            "--pbf", str(source), "--output", str(output)], check=True, capture_output=True)
            entries = {f"{e['type']}-{e['id']}": e for e in json.loads(output.read_text())["elements"]}
            self.assertEqual(set(entries), {"node-5", "relation-20"})
            self.assertEqual(entries["node-5"]["tags"]["leisure"], "indoor_play")
            self.assertAlmostEqual(entries["relation-20"]["lat"], 51.305)
            self.assertAlmostEqual(entries["relation-20"]["lon"], -.795)

if __name__ == "__main__":
    unittest.main()
