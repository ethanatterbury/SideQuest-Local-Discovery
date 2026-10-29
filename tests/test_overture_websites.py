import gzip
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('overture_audit', Path(__file__).parents[1] / 'scripts/audit-overture-websites.py')
audit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(audit)
HAS_ARROW = importlib.util.find_spec('pyarrow') is not None


class OvertureWebsiteAuditTests(unittest.TestCase):
    def test_fixed_release_paths_and_no_untrusted_stac_assets(self):
        path = 's3://overturemaps-us-west-2/release/2026-10-21.0/theme=places/type=place/part-001.parquet'
        self.assertEqual(audit.source_url(path), 'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/release/2026-10-21.0/theme=places/type=place/part-001.parquet')
        for bad in (path.replace('2026-10-21.0', 'latest'), path.replace('overturemaps-us-west-2', 'evil.example'), path + '?token=x', path.replace('part-001', '../part-001')):
            with self.assertRaises(ValueError):
                audit.source_url(bad)

    def test_byte_and_request_budgets_reserve_before_network(self):
        budget = audit.Budget(max_bytes=5, max_requests=2, deadline_seconds=60)
        budget.reserve(3)
        with self.assertRaises(audit.QuotaExceeded):
            budget.reserve(3)
        self.assertEqual(budget.reserved, 3)
        budget.request()
        budget.request()
        with self.assertRaises(audit.QuotaExceeded):
            budget.request()

    def test_stac_bbox_is_subject_file_extent_and_only_place_assets_selected(self):
        def item(collection='place', box=None, path='part-1.parquet'):
            return {'type': 'Feature', 'collection': collection,
                    'bbox': box or {'xmin': -1, 'ymin': 51, 'xmax': 0, 'ymax': 52},
                    'assets': {'aws': {'alternate': {'s3': {'href': f's3://overturemaps-us-west-2/release/{audit.RELEASE}/theme=places/type=place/{path}'}}}}}
        result = audit.select_assets([item(), item('building'), item(box={'xmin': 10, 'ymin': 10, 'xmax': 11, 'ymax': 11}), item()])
        self.assertEqual(len(result), 1)
        self.assertTrue(result[0].endswith('part-1.parquet'))

    def test_range_reader_is_seekable_without_whole_file_download(self):
        class Transport:
            def head(self, url):
                return 1_000_000
            def read_range(self, url, start, size, total):
                self.last = (start, size, total)
                return b'x' * size
        transport = Transport()
        reader = audit.RangeReader('https://fixed', transport)
        self.assertEqual(reader.seek(-8, io.SEEK_END), 999992)
        self.assertEqual(reader.read(4), b'xxxx')
        self.assertEqual(transport.last, (999992, 4, 1_000_000))
        self.assertEqual(reader.tell(), 999996)
        with self.assertRaises(ValueError):
            reader.seek(-1)

    def test_exact_distinctive_names_distance_and_unique_existing_venue(self):
        venues = [dict(id='osm-node-1', name="Ruby's Play Cafe", lat=51.3, lng=-0.8, hasWebsite=False)]
        grid = audit.venue_grid(venues)
        row = dict(id='gers-1', names={'primary': 'Rubys Play Cafe'}, bbox={'xmin': -0.8, 'xmax': -0.8, 'ymin': 51.3, 'ymax': 51.3}, websites=['https://rubys.example.org/'], confidence=0.8, operating_status='open')
        matched = audit.match_row(row, grid)
        self.assertEqual(matched[0]['query']['id'], 'osm-node-1')
        self.assertFalse(matched[0]['mappedWebsitePresent'])
        for change in ({'names': {'primary': 'Other Play Cafe'}}, {'confidence': 0.49}, {'operating_status': 'permanently_closed'}, {'bbox': {'xmin': -0.8, 'xmax': -0.8, 'ymin': 51.31, 'ymax': 51.31}}):
            self.assertEqual(audit.match_row({**row, **change}, grid), [])
        self.assertEqual(audit.match_row(row, audit.venue_grid(venues + [{**venues[0], 'id': 'osm-way-2'}])), [])

    def test_generic_names_and_social_or_unsafe_urls_never_become_candidates(self):
        self.assertFalse(audit.distinctive('playground'))
        self.assertFalse(audit.distinctive('leisure centre'))
        for url in ('https://127.0.0.1/a', 'https://localhost/a', 'https://x.local/a', 'https://user:pass@venue.org/', 'https://facebook.com/venue', 'https://openstreetmap.org/node/1', 'http://venue.org/'):
            self.assertIsNone(audit.website_url(url))
        self.assertEqual(audit.website_url('https://venue.org/path#about'), 'https://venue.org/path')

    @unittest.skipUnless(HAS_ARROW, 'Install pinned PyArrow for actual Parquet fixtures')
    def test_actual_arrow_rowgroups_are_filtered_and_projected(self):
        import pyarrow as pa
        import pyarrow.parquet as pq
        table = pa.Table.from_pylist([
            {'id': 'uk', 'names': {'primary': 'Acorn Adventure'}, 'bbox': {'xmin': -1., 'xmax': -1., 'ymin': 51., 'ymax': 51.}, 'websites': ['https://acorn.org/'], 'confidence': 0.9, 'operating_status': 'open', 'unwanted': 'secret-column'},
            {'id': 'abroad', 'names': {'primary': 'Abroad'}, 'bbox': {'xmin': 40., 'xmax': 40., 'ymin': 10., 'ymax': 10.}, 'websites': ['https://abroad.org/'], 'confidence': 0.9, 'operating_status': 'open', 'unwanted': 'secret-column'},
        ])
        sink = io.BytesIO()
        pq.write_table(table, sink, row_group_size=1)
        parquet = pq.ParquetFile(pa.BufferReader(sink.getvalue()))
        self.assertTrue(audit.relevant_group(parquet.metadata.row_group(0)))
        self.assertFalse(audit.relevant_group(parquet.metadata.row_group(1)))
        columns = audit.projected_columns(parquet.schema_arrow)
        self.assertNotIn('unwanted', columns)
        self.assertEqual(parquet.read_row_group(0, columns=columns).to_pylist()[0]['names']['primary'], 'Acorn Adventure')

    @unittest.skipUnless(HAS_ARROW, 'Install pinned PyArrow for actual Parquet fixtures')
    def test_real_parquet_reads_use_exact_http_ranges_under_the_shared_cap(self):
        import pyarrow as pa
        import pyarrow.parquet as pq
        table = pa.Table.from_pylist([
            {'id': str(index), 'names': {'primary': 'Acorn Adventure'},
             'bbox': {'xmin': -1., 'xmax': -1., 'ymin': 51., 'ymax': 51.},
             'websites': ['https://acorn.org/'], 'confidence': 0.9,
             'operating_status': 'open', 'unwanted': os.urandom(20000).hex()}
            for index in range(50)
        ])
        sink = io.BytesIO()
        pq.write_table(table, sink, compression='NONE', row_group_size=25)
        data = sink.getvalue()
        class Response(io.BytesIO):
            def __init__(self, content, status, headers):
                super().__init__(content)
                self.status, self.headers = status, headers
        class Opener:
            def open(self, request, timeout):
                if request.method == 'HEAD':
                    return Response(b'', 200, {'Content-Length': str(len(data))})
                start, end = map(int, request.headers['Range'][6:].split('-'))
                return Response(data[start:end + 1], 206, {
                    'Content-Length': str(end - start + 1),
                    'Content-Range': f'bytes {start}-{end}/{len(data)}'})
        budget = audit.Budget(max_bytes=len(data) // 2)
        transport = audit.HttpTransport(budget, opener=Opener())
        url = audit.source_url(f's3://{audit.BUCKET}{audit.PREFIX}test.parquet')
        with audit.RangeReader(url, transport) as remote, pa.PythonFile(remote, mode='r') as source:
            parquet = pq.ParquetFile(source, pre_buffer=False, buffer_size=0)
            rows = parquet.read_row_group(0, columns=audit.projected_columns(parquet.schema_arrow)).to_pylist()
        self.assertEqual(len(rows), 25)
        self.assertLess(budget.received, len(data) // 2)
        self.assertLessEqual(budget.received, budget.reserved)

    def test_http_server_cannot_silently_force_a_whole_file_download(self):
        class Response(io.BytesIO):
            status = 200
            headers = {'Content-Length': '10000000'}
            def read(self, size=-1):
                raise AssertionError('Unbounded response body must never be read')
        class Opener:
            def open(self, request, timeout):
                return Response()
        budget = audit.Budget(max_bytes=100)
        transport = audit.HttpTransport(budget, opener=Opener())
        url = audit.source_url(f's3://{audit.BUCKET}{audit.PREFIX}test.parquet')
        with self.assertRaises(ValueError):
            transport.read_range(url, 0, 10, 10000000)
        self.assertEqual(budget.received, 0)
        with self.assertRaises(audit.QuotaExceeded):
            transport.read_range(url, 0, 100, 10000000)
        self.assertEqual(budget.requests, 1)

    def test_output_is_candidate_only_and_atomic_with_explicit_partial_status(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'candidates.json.gz'
            audit.write_candidates(output, [], {'complete': False, 'partialReason': 'quota'})
            data = json.loads(gzip.decompress(output.read_bytes()))
            self.assertEqual(data['status'], 'website-candidates-only')
            self.assertFalse(data['summary']['complete'])
            self.assertEqual(data['entries'], [])
            self.assertNotIn('image', data)

    @unittest.skipUnless(HAS_ARROW, 'Install pinned PyArrow for actual audit fixtures')
    def test_source_errors_write_failed_incomplete_evidence_and_still_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            venue_dir = Path(directory) / 'venues'
            venue_dir.mkdir()
            (venue_dir / '1_1.json').write_text(json.dumps({'places': [{
                'id': 'osm-node-1', 'name': 'Acorn Adventure',
                'coordinates': {'lat': 51.3, 'lng': -0.8}}]}))
            summary = Path(directory) / 'summary.json'
            with patch.object(audit, 'HttpTransport') as transport:
                transport.return_value.index.side_effect = OSError('source unavailable')
                with self.assertRaisesRegex(OSError, 'source unavailable'):
                    audit.run_audit(venue_dir, Path(directory) / 'candidates.json.gz', summary)
            evidence = json.loads(summary.read_text())
            self.assertFalse(evidence['complete'])
            self.assertEqual(evidence['coverageStatus'], 'failed')
            self.assertEqual(evidence['imageRequests'], 0)

    @unittest.skipUnless(HAS_ARROW, 'Install pinned PyArrow for actual audit fixtures')
    def test_intentional_quota_stop_reports_partial_coverage_without_fake_completion(self):
        with tempfile.TemporaryDirectory() as directory:
            venue_dir = Path(directory) / 'venues'
            venue_dir.mkdir()
            (venue_dir / '1_1.json').write_text(json.dumps({'places': [{
                'id': 'osm-node-1', 'name': 'Acorn Adventure',
                'coordinates': {'lat': 51.3, 'lng': -0.8}}]}))
            with patch.object(audit, 'HttpTransport') as transport:
                transport.return_value.index.side_effect = audit.QuotaExceeded('response-body-byte-cap')
                evidence = audit.run_audit(venue_dir, Path(directory) / 'candidates.json.gz', Path(directory) / 'summary.json')
            self.assertFalse(evidence['complete'])
            self.assertEqual(evidence['coverageStatus'], 'partial')
            self.assertEqual(evidence['partialReason'], 'response-body-byte-cap')


if __name__ == '__main__':
    unittest.main()
