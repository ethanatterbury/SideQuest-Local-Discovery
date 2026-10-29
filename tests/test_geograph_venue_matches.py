"""Tiny real gzip fixtures exercise the metadata importer without network or images."""
import gzip
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/import-geograph-venue-matches.py'
spec = importlib.util.spec_from_file_location('geograph_matches', SCRIPT)
module = importlib.util.module_from_spec(spec)
if SCRIPT.exists():
    spec.loader.exec_module(module)


def base(photo_id=1, title='Wellington Country Park', lat=51.35, lng=-0.8, taken='2025-03-04'):
    return [str(photo_id), '42', 'Jane\\tPhotographer', title, 'geograph', taken,
            'SU8261', '1', '2', str(lat), str(lng), '1']


def geo(photo_id=1, digits='10', privacy='0'):
    return [str(photo_id), '482610', '161220', digits, '0', '0', '0', '-1', privacy]


class GeographMatchingTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SCRIPT.exists(), 'The streaming Geograph importer must exist')
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.venues = self.root / 'venues'
        self.venues.mkdir()
        self.output = self.root / 'matches.json.gz'

    def tearDown(self):
        if hasattr(self, 'temp'):
            self.temp.cleanup()

    def run_import(self, bases=None, geos=None, places=None, **kwargs):
        places = places or [dict(id='osm-way-1', name='Wellington Country Park',
                                 coordinates=dict(lat=51.35, lng=-0.8))]
        (self.venues / '200_1.json').write_text(json.dumps(dict(version=2, places=places)))
        paths = []
        for name, rows in [('base', bases or [base()]), ('geo', geos or [geo()])]:
            path = self.root / (name + '.tsv.gz')
            text = ''.join('\t'.join(row) + '\n' for row in rows)
            path.write_bytes(gzip.compress(text.encode('utf-8'), mtime=0))
            paths.append(path)
        return module.build_matches(self.venues, *paths, self.output, **kwargs)

    def read(self):
        with gzip.open(self.output, 'rt') as stream:
            return json.load(stream)

    def test_matches_precise_subject_and_preserves_provenance_without_images(self):
        summary = self.run_import()
        result = self.read()
        self.assertEqual(summary['matchedVenues'], 1)
        entry = result['entries'][0]
        self.assertEqual(entry['query']['id'], 'osm-way-1')
        candidate = entry['candidates'][0]
        self.assertEqual(candidate['geographId'], 1)
        self.assertEqual(candidate['photographer'], 'Jane\tPhotographer')
        self.assertEqual(candidate['photoTaken'], '2025-03-04')
        self.assertEqual(candidate['coordinates'], {'lat': 51.35, 'lng': -0.8})
        self.assertEqual(candidate['subjectPrecision']['digits'], 10)
        self.assertEqual(candidate['license'], 'CC BY-SA 2.0')
        self.assertEqual(candidate['status'], 'candidate')
        self.assertNotIn('imageUrl', candidate)
        self.assertNotIn('approved', candidate)

    def test_rejects_generic_names_and_optional_categories(self):
        for name, extras in [('Country Park', {}), ('The Playground', {}), ('The Castle', {}), ('Aquarium', {}),
                             ('Wellington Country Park', {'optionalCategory': 'pubs'})]:
            with self.subTest(name=name):
                self.run_import(bases=[base(title=name)], places=[dict(
                    id='osm-way-1', name=name, coordinates=dict(lat=51.35, lng=-0.8), **extras),
                    dict(id='osm-way-other', name='Unrelated Castle', coordinates=dict(lat=53, lng=-1))])
                self.assertEqual(self.read()['entries'], [])

    def test_rejects_coarse_missing_subject_privacy_and_excess_distance(self):
        for digits, privacy, east, lat in [('4', '0', '482610', 51.35),
                                           ('6', '0', '482610', 51.35),
                                           ('10', '1', '482610', 51.35),
                                           ('10', '0', '0', 51.35),
                                           ('10', '0', '482610', 51.352)]:
            with self.subTest(digits=digits, privacy=privacy, east=east, lat=lat):
                row = geo(digits=digits, privacy=privacy)
                row[1] = east
                self.run_import(bases=[base(lat=lat)], geos=[row])
                self.assertEqual(self.read()['entries'], [])

    def test_rejects_ambiguous_nearby_names_and_mentions(self):
        venue = dict(id='osm-way-1', name='Wellington Country Park', coordinates=dict(lat=51.35, lng=-0.8))
        duplicate = dict(venue, id='osm-way-2', coordinates=dict(lat=51.3501, lng=-0.8))
        self.run_import(places=[venue, duplicate])
        self.assertEqual(self.read()['entries'], [])
        for prefix in ['Road to ', 'Car park at ', 'Near ', 'Looking towards ', 'View from ', 'Entrance to ', 'Footpath beside ']:
            with self.subTest(prefix=prefix):
                self.run_import(bases=[base(title=prefix + venue['name'])])
                self.assertEqual(self.read()['entries'], [])

    def test_schema_and_types_fail_closed_without_overwriting_output(self):
        self.run_import()
        before = self.output.read_bytes()
        for bad in [base()[:-1], ['gridimage_id'] + base()[1:], base()[:9] + ['not-a-coordinate'] + base()[10:]]:
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    self.run_import(bases=[bad])
                self.assertEqual(self.output.read_bytes(), before)
        with self.assertRaises(ValueError):
            module.validate_schema('CREATE TABLE gridimage_base (`title` varchar(128));', module.BASE_COLUMNS)

    def test_escaped_text_not_tsv_structure_and_output_is_reproducible(self):
        self.assertEqual(module.unescape_mysql(r'A\tB\nC\\D'), 'A\tB\nC\\D')
        self.run_import()
        before = self.output.read_bytes()
        self.run_import()
        self.assertEqual(self.output.read_bytes(), before)

    def test_keeps_only_three_best_candidates_in_stable_order(self):
        rows = [base(photo_id=i, taken=f'202{i}-01-01') for i in range(1, 6)]
        self.run_import(bases=list(reversed(rows)), geos=[geo(i) for i in range(1, 6)])
        self.assertEqual([x['geographId'] for x in self.read()['entries'][0]['candidates']], [5, 4, 3])

    def test_recent_precise_photo_ranks_before_older_higher_precision_photo(self):
        self.run_import(bases=[base(1, taken='2019-01-01'), base(2, taken='2025-01-01')],
                        geos=[geo(1, digits='10'), geo(2, digits='8')])
        self.assertEqual([x['geographId'] for x in self.read()['entries'][0]['candidates']], [2, 1])

    def test_identity_rounding_matches_javascript_to_fixed_at_binary_ties(self):
        query = dict(id='osm-way-1', name='Wellington Country Park', lat=51.03125, lng=-0.03125)
        self.assertEqual(json.loads(module.query_identity(query)),
                         ['osm-way-1', 'wellingtoncountrypark', '51.0313', '-0.0313'])
        self.assertEqual(json.loads(module.query_identity(dict(query, lng=-0.0)))[3], '0.0000')

    def test_future_and_impossible_dates_are_not_candidates(self):
        for taken in ['9999-01-01', '2024-02-31']:
            with self.subTest(taken=taken):
                self.run_import(bases=[base(taken=taken)])
                self.assertEqual(self.read()['entries'], [])

    def test_bounded_download_discards_partial_file_and_reuses_complete_cache(self):
        class Response:
            headers = {}
            def __init__(self):
                self.read_sizes = []
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False
            def read(self, size):
                self.read_sizes.append(size)
                return b'x' * size
        response = Response()
        destination = self.root / 'download.tsv.gz'
        with patch.object(module.urllib.request, 'urlopen', return_value=response):
            with self.assertRaises(ValueError):
                module.download(module.SOURCE_ROOT + 'gridimage_base.tsv.gz', destination, 20)
        self.assertFalse(destination.exists())
        self.assertFalse((self.root / 'download.tsv.gz.partial').exists())
        self.assertEqual(response.read_sizes, [21])
        destination.write_bytes(b'cached')
        with patch.object(module.urllib.request, 'urlopen', side_effect=AssertionError('cache must not redownload')):
            module.download(module.SOURCE_ROOT + 'gridimage_base.tsv.gz', destination, 20)
        self.assertEqual(destination.read_bytes(), b'cached')

    def test_runtime_schema_checks_exact_column_order_and_types(self):
        types = module.BASE_TYPES
        schema = 'CREATE TABLE `gridimage_base` (\n' + ',\n'.join(
            f'`{column}` {kind} NOT NULL' for column, kind in zip(module.BASE_COLUMNS, types)) + '\n);'
        module.validate_schema(schema, module.BASE_COLUMNS)
        with self.assertRaises(ValueError):
            module.validate_schema(schema.replace('`wgs84_lat` decimal(10,6)', '`wgs84_lat` varchar(10)'), module.BASE_COLUMNS)

    def test_bounds_decompression_and_candidate_work(self):
        with self.assertRaises(ValueError):
            self.run_import(max_uncompressed_bytes=10)
        with self.assertRaises(ValueError):
            self.run_import(max_candidates=0)
        self.assertFalse(self.output.exists())


if __name__ == '__main__':
    unittest.main()
