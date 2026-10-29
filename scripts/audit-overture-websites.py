#!/usr/bin/env python3
"""Read-only, byte-bounded Overture website coverage pilot. No image requests.

Primary contracts: docs.overturemaps.org/schema/reference/places/place/ and
OvertureMaps/overturemaps-py/overturemaps/core.py (_get_files_from_stac).
"""
import argparse
from collections import defaultdict
import gzip
import hashlib
import io
import ipaddress
import json
import math
from pathlib import Path
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

RELEASE = '2026-10-21.0'
INDEX_URL = f'https://stac.overturemaps.org/{RELEASE}/collections.parquet'
BUCKET = 'overturemaps-us-west-2'
HOST = f'{BUCKET}.s3.us-west-2.amazonaws.com'
PREFIX = f'/release/{RELEASE}/theme=places/type=place/'
BBOX = (-6.6, 49.8, 2.1, 55.9)
MAX_BYTES = 2 * 1024**3
USER_AGENT = 'SideQuest-Overture-coverage-audit/1.0 (https://github.com/ethanatterbury/SideQuest-Local-Discovery)'
GENERIC = set('the and of a an at in on for to park garden gardens nature reserve national '
              'museum gallery hall town village community leisure centre center playground '
              'play area playing fields recreation ground memorial common green sports club '
              'house visitor attraction viewpoint swimming pool adventure golf miniature '
              'cinema theatre theater north south east west central heritage public local '
              'old new church chapel cathedral abbey castle zoo aquarium station lake '
              'valley wood woods forest beach monument sculpture statue tower mill farm barn'.split())
NONOFFICIAL = ('facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com',
               'tripadvisor.com', 'tripadvisor.co.uk', 'yell.com', 'google.com', 'google.co.uk',
               'goo.gl', 'maps.app.goo.gl', 'openstreetmap.org', 'wikidata.org', 'wikipedia.org')


class QuotaExceeded(RuntimeError):
    pass


class Budget:
    """Reserve response body bytes before issuing requests; failed reads consume quota."""
    def __init__(self, max_bytes=MAX_BYTES, max_requests=12000, deadline_seconds=1100):
        if not 1 <= max_bytes <= MAX_BYTES:
            raise ValueError('Body-byte cap must be between 1 byte and 2 GiB')
        self.maximum = max_bytes
        self.reserved = 0
        self.received = 0
        self.requests = 0
        self.max_requests = max_requests
        self.began = time.monotonic()
        self.deadline = self.began + deadline_seconds

    def check(self):
        if time.monotonic() >= self.deadline:
            raise QuotaExceeded('runtime-deadline')

    def reserve(self, amount):
        self.check()
        if not isinstance(amount, int) or amount < 0 or self.reserved + amount > self.maximum:
            raise QuotaExceeded('response-body-byte-cap')
        self.reserved += amount

    def request(self):
        self.check()
        if self.requests >= self.max_requests:
            raise QuotaExceeded('request-count-cap')
        self.requests += 1


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Redirects are not permitted for fixed Overture sources')


def source_url(path):
    if not isinstance(path, str):
        raise ValueError('Invalid source asset')
    value = urllib.parse.urlsplit(path)
    if (value.scheme != 's3' or value.netloc != BUCKET or value.query or value.fragment
            or not value.path.startswith(PREFIX)):
        raise ValueError('Unapproved Overture source path')
    filename = value.path[len(PREFIX):]
    if not re.fullmatch(r'[A-Za-z0-9_=-][A-Za-z0-9._=-]{0,250}\.parquet', filename) or '..' in filename:
        raise ValueError('Unapproved Overture asset filename')
    return f'https://{HOST}{PREFIX}{filename}'


def checked_source_url(url):
    if url == INDEX_URL:
        return
    value = urllib.parse.urlsplit(url)
    if value.scheme != 'https' or value.netloc != HOST:
        raise ValueError('Unapproved metadata host')
    if source_url(f's3://{BUCKET}{value.path}') != url:
        raise ValueError('Unapproved metadata URL')


class HttpTransport:
    def __init__(self, budget, opener=None):
        self.budget = budget
        self.opener = opener or urllib.request.build_opener(NoRedirect())

    def open(self, url, *, method='GET', headers=None):
        checked_source_url(url)
        self.budget.request()
        request = urllib.request.Request(url, method=method, headers={
            'User-Agent': USER_AGENT, 'Accept-Encoding': 'identity', **(headers or {})})
        remaining = self.budget.deadline - time.monotonic()
        return self.opener.open(request, timeout=max(0.1, min(30, remaining)))

    def head(self, url):
        with self.open(url, method='HEAD') as response:
            if response.status != 200 or response.headers.get('Content-Encoding', 'identity') != 'identity':
                raise ValueError('Unexpected source object metadata')
            size = int(response.headers.get('Content-Length', '0'))
            if not 8 <= size <= 2 * 1024**4:
                raise ValueError('Unexpected source object length')
            return size

    def read_range(self, url, start, size, total):
        if size == 0:
            return b''
        if min(start, size) < 0 or start + size > total:
            raise ValueError('Invalid requested source byte range')
        if size > 64 * 1024**2:
            raise QuotaExceeded('individual-range-size-cap')
        self.budget.reserve(size)
        end = start + size - 1
        with self.open(url, headers={'Range': f'bytes={start}-{end}'}) as response:
            if (response.status != 206 or response.headers.get('Content-Range') != f'bytes {start}-{end}/{total}'
                    or int(response.headers.get('Content-Length', '-1')) != size
                    or response.headers.get('Content-Encoding', 'identity') != 'identity'):
                raise ValueError('Source did not honour the exact bounded byte range')
            chunks, count = [], 0
            while count < size:
                self.budget.check()
                chunk = response.read(min(65536, size - count))
                if not chunk:
                    raise ValueError('Truncated source byte range')
                self.budget.received += len(chunk)
                count += len(chunk)
                chunks.append(chunk)
            return b''.join(chunks)

    def index(self):
        maximum = 64 * 1024**2
        with self.open(INDEX_URL) as response:
            if response.status != 200:
                raise ValueError('Unexpected STAC response')
            stated = response.headers.get('Content-Length')
            if stated and int(stated) > maximum:
                raise QuotaExceeded('STAC-index-size-cap')
            chunks, total = [], 0
            while True:
                size = min(65536, maximum - total)
                if size <= 0:
                    raise QuotaExceeded('STAC-index-size-cap')
                self.budget.reserve(size)
                chunk = response.read(size)
                if not chunk:
                    break
                self.budget.received += len(chunk)
                total += len(chunk)
                chunks.append(chunk)
            return b''.join(chunks)


class RangeReader(io.RawIOBase):
    def __init__(self, url, transport):
        super().__init__()
        self.url, self.transport = url, transport
        self.size = transport.head(url)
        self.position = 0

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=io.SEEK_SET):
        position = offset + (self.position if whence == io.SEEK_CUR else self.size if whence == io.SEEK_END else 0)
        if whence not in (io.SEEK_SET, io.SEEK_CUR, io.SEEK_END) or position < 0 or position > self.size:
            raise ValueError('Invalid source seek')
        self.position = position
        return position

    def read(self, size=-1):
        self._checkClosed()
        size = self.size - self.position if size is None or size < 0 else min(size, self.size - self.position)
        data = self.transport.read_range(self.url, self.position, size, self.size)
        self.position += len(data)
        return data

    def readinto(self, buffer):
        data = self.read(len(buffer))
        buffer[:len(data)] = data
        return len(data)


def intersects(box):
    if not isinstance(box, dict):
        raise ValueError('Unverified STAC bbox shape')
    values = [box.get(key) for key in ('xmin', 'ymin', 'xmax', 'ymax')]
    if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in values):
        raise ValueError('Invalid source bbox')
    xmin, ymin, xmax, ymax = values
    if xmin > xmax or ymin > ymax:
        raise ValueError('Invalid source bbox ordering')
    return xmax >= BBOX[0] and xmin <= BBOX[2] and ymax >= BBOX[1] and ymin <= BBOX[3]


def select_assets(rows):
    urls = set()
    for row in rows:
        if row.get('collection') != 'place' or row.get('type') != 'Feature' or not intersects(row.get('bbox')):
            continue
        path = row.get('assets', {}).get('aws', {}).get('alternate', {}).get('s3', {}).get('href')
        urls.add(source_url(path))
    if not urls or len(urls) > 1024:
        raise ValueError('No bounded place assets selected from the release STAC')
    return sorted(urls)


def relevant_group(group):
    stats = {}
    for index in range(group.num_columns):
        column = group.column(index)
        if column.path_in_schema in ('bbox.xmin', 'bbox.xmax', 'bbox.ymin', 'bbox.ymax'):
            statistic = column.statistics
            if statistic and statistic.has_min_max:
                stats[column.path_in_schema] = statistic
    if len(stats) != 4:
        return True  # Missing statistics cannot prove that the group is outside.
    return intersects({'xmin': stats['bbox.xmin'].min, 'xmax': stats['bbox.xmax'].max,
                       'ymin': stats['bbox.ymin'].min, 'ymax': stats['bbox.ymax'].max})


def projected_columns(schema):
    required = {'id', 'names', 'bbox', 'websites', 'confidence'}
    if not required.issubset(schema.names):
        raise ValueError('Pinned Overture place schema changed')
    return ['id', 'names.primary', 'bbox', 'websites', 'confidence'] + (['operating_status'] if 'operating_status' in schema.names else [])


def normalized_name(value):
    value = ''.join(c for c in unicodedata.normalize('NFKD', value.lower()) if not unicodedata.combining(c))
    value = value.replace("'", '').replace('’', '').replace('&', ' and ').replace('+', ' and ')
    return ' '.join(re.sub(r'[^\w]+', ' ', value, flags=re.UNICODE).replace('_', ' ').split()).removeprefix('the ')


def distinctive(name):
    words = [word for word in normalized_name(name).split() if word not in GENERIC and not word.isdecimal()]
    return any(len(word) >= 5 for word in words) or len({word for word in words if len(word) >= 3}) >= 2


def website_url(value):
    if not isinstance(value, str) or len(value) > 2000 or re.search(r'[\x00-\x20\x7f]', value):
        return None
    try:
        url = urllib.parse.urlsplit(value)
        host = (url.hostname or '').lower().rstrip('.')
        if (url.scheme != 'https' or not host or '.' not in host or url.username or url.password or url.port
                or any(host == domain or host.endswith('.' + domain) for domain in NONOFFICIAL)
                or re.search(r'(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$', host)):
            return None
        try:
            ipaddress.ip_address(host)
            return None
        except ValueError:
            pass
        return urllib.parse.urlunsplit(('https', url.netloc, url.path or '/', url.query, ''))
    except ValueError:
        return None


def cell(lat, lng):
    return math.floor(lat / .001), math.floor(lng / .002)


def venue_grid(venues):
    grid = defaultdict(list)
    for venue in venues:
        if distinctive(venue['name']):
            grid[cell(venue['lat'], venue['lng'])].append(venue)
    return grid


def distance(a, b, c, d):
    rad = math.pi / 180
    h = math.sin((c - a) * rad / 2)**2 + math.cos(a * rad) * math.cos(c * rad) * math.sin((d - b) * rad / 2)**2
    return 6371008.8 * 2 * math.asin(min(1, math.sqrt(h)))


def match_row(row, grid):
    name = row.get('names', {}).get('primary') if isinstance(row.get('names'), dict) else None
    confidence = row.get('confidence')
    if (not isinstance(name, str) or not name.strip() or len(name) > 300
            or type(confidence) not in (int, float) or not math.isfinite(confidence) or not .5 <= confidence <= 1
            or row.get('operating_status') not in (None, 'open')
            or not isinstance(row.get('websites'), list)):
        return []
    urls = sorted({url for item in (row.get('websites') or []) if (url := website_url(item))})[:3]
    if not urls or not intersects(row.get('bbox')):
        return []
    box = row['bbox']
    lat, lng = (box['ymin'] + box['ymax']) / 2, (box['xmin'] + box['xmax']) / 2
    y, x = cell(lat, lng)
    matches = []
    normalized = normalized_name(name)
    for gy in range(y - 1, y + 2):
        for gx in range(x - 1, x + 2):
            for venue in grid.get((gy, gx), ()):
                metres = distance(lat, lng, venue['lat'], venue['lng'])
                if normalized_name(venue['name']) == normalized and metres <= 75:
                    matches.append((venue, metres))
    if len(matches) != 1:
        return []
    venue, metres = matches[0]
    return [{
        'query': {key: venue[key] for key in ('id', 'name', 'lat', 'lng')},
        'mappedWebsitePresent': venue['hasWebsite'], 'overtureId': row.get('id'),
        'sourceName': name, 'coordinates': {'lat': lat, 'lng': lng},
        'distanceMetres': round(metres, 2), 'confidence': confidence,
        'operatingStatus': row.get('operating_status'), 'websiteCandidates': urls,
        'evidence': ['exact normalized distinctive name', 'unique existing OSM venue within 75 metres'],
        'status': 'unapproved-website-candidates',
    }]


def load_venues(directory):
    venues = {}
    for path in sorted(Path(directory).glob('*.json')):
        if not re.fullmatch(r'\d+_-?\d+\.json', path.name):
            continue
        for place in json.loads(path.read_text()).get('places', []):
            if 'optionalCategory' in place:
                continue
            coordinates = place.get('coordinates') or {}
            website = place.get('website') or ''
            if website.startswith('http://'):
                website = 'https://' + website[7:]
            elif website.startswith('www.'):
                website = 'https://' + website
            query = {'id': place['id'], 'name': place['name'], 'lat': coordinates.get('lat'),
                     'lng': coordinates.get('lng'), 'hasWebsite': bool(website_url(website))}
            if (not isinstance(query['id'], str) or not isinstance(query['name'], str)
                    or not all(isinstance(query[key], (int, float)) and math.isfinite(query[key]) for key in ('lat', 'lng'))):
                raise ValueError('Invalid prepared venue identity')
            if query['id'] in venues and venues[query['id']] != query:
                raise ValueError('Conflicting prepared venue identity')
            venues[query['id']] = query
    if not venues or len(venues) > 100000:
        raise ValueError('Missing or oversized prepared activity catalogue')
    return list(venues.values())


def write_candidates(path, entries, summary):
    result = {'version': 1, 'release': RELEASE, 'schemaVersion': '2.0.0',
              'status': 'website-candidates-only', 'sourceIndex': INDEX_URL,
              'licenses': ['CDLA-Permissive-2.0', 'Apache-2.0', 'CC0-1.0'],
              'licenseNotice': 'https://docs.overturemaps.org/attribution/#places',
              'licenseTexts': ['https://cdla.dev/permissive-2-0/',
                               'https://www.apache.org/licenses/LICENSE-2.0',
                               'https://creativecommons.org/publicdomain/zero/1.0/'],
              'summary': summary, 'entries': entries}
    data = json.dumps(result, ensure_ascii=False, separators=(',', ':')).encode()
    if len(data) > 32 * 1024**2:
        raise QuotaExceeded('output-metadata-size-cap')
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.partial')
    try:
        with temporary.open('wb') as raw, gzip.GzipFile(fileobj=raw, filename='', mode='wb', mtime=0) as output:
            output.write(data)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def run_audit(venues_dir, output, summary_path, max_bytes=MAX_BYTES, max_seconds=1100):
    import pyarrow as pa
    import pyarrow.parquet as pq
    pa.set_cpu_count(2)
    venues = load_venues(venues_dir)
    grid = venue_grid(venues)
    budget = Budget(max_bytes=max_bytes, deadline_seconds=max_seconds)
    transport = HttpTransport(budget)
    result = {'scope': 'England bbox matched only to existing default OSM activities', 'bbox': BBOX,
              'release': RELEASE, 'defaultVenues': len(venues),
              'activitiesWithMappedWebsite': sum(v['hasWebsite'] for v in venues),
              'filesPlanned': 0, 'filesScanned': 0, 'rowGroupsRead': 0, 'rowGroupsSkipped': 0,
              'sourceRowsRead': 0, 'rowsInsideBbox': 0, 'rowsWithWebsite': 0,
              'confidenceHistogram': {str(i / 10): 0 for i in range(10)},
              'complete': False, 'coverageStatus': 'partial',
              'approvedWebsites': 0, 'approvedImages': 0, 'imageRequests': 0}
    matches = {}
    failure = None
    try:
        index_bytes = transport.index()
        result['sourceIndexSha256'] = hashlib.sha256(index_bytes).hexdigest()
        index = pq.read_table(pa.BufferReader(index_bytes))
        if index.num_rows > 100000:
            raise QuotaExceeded('STAC-index-row-cap')
        urls = select_assets(index.to_pylist())
        result['filesPlanned'] = len(urls)
        for url in urls:
            budget.check()
            with RangeReader(url, transport) as remote, pa.PythonFile(remote, mode='r') as source:
                parquet = pq.ParquetFile(source, pre_buffer=False, buffer_size=0)
                columns = projected_columns(parquet.schema_arrow)
                if parquet.metadata.num_row_groups > 20000:
                    raise QuotaExceeded('Parquet-row-group-cap')
                for group_index in range(parquet.metadata.num_row_groups):
                    budget.check()
                    group = parquet.metadata.row_group(group_index)
                    if not relevant_group(group):
                        result['rowGroupsSkipped'] += 1
                        continue
                    if group.total_byte_size > 512 * 1024**2 or group.num_rows > 1000000:
                        raise QuotaExceeded('decoded-row-group-size-cap')
                    table = parquet.read_row_group(group_index, columns=columns, use_threads=False)
                    result['rowGroupsRead'] += 1
                    for batch in table.to_batches(max_chunksize=4096):
                        budget.check()
                        for row in batch.to_pylist():
                            result['sourceRowsRead'] += 1
                            if not intersects(row.get('bbox')):
                                continue
                            result['rowsInsideBbox'] += 1
                            confidence = row.get('confidence')
                            if isinstance(confidence, (int, float)) and math.isfinite(confidence) and 0 <= confidence <= 1:
                                bucket = str(min(9, int(confidence * 10)) / 10)
                                result['confidenceHistogram'][bucket] += 1
                            if row.get('websites'):
                                result['rowsWithWebsite'] += 1
                            for match in match_row(row, grid):
                                match['sourceAssetUrl'] = url
                                key = (match['query']['id'], match['overtureId'])
                                matches[key] = match
                    print(json.dumps({'phase': 'row-group', 'files': result['filesScanned'], 'rows': result['sourceRowsRead'],
                                      'candidateMatches': len(matches), 'receivedBodyBytes': budget.received,
                                      'seconds': round(time.monotonic() - budget.began, 1)}), flush=True)
            result['filesScanned'] += 1
        result['complete'] = True
        result['coverageStatus'] = 'complete'
    except QuotaExceeded as error:
        result['partialReason'] = str(error)
    except Exception as error:
        result['coverageStatus'] = 'failed'
        result['partialReason'] = f'{type(error).__name__}: {error}'[:500]
        failure = error
    entries = sorted(matches.values(), key=lambda m: (m['query']['id'], -m['confidence'], m['overtureId']))
    counts, selected = defaultdict(int), []
    for entry in entries:
        key = entry['query']['id']
        if counts[key] < 3:
            selected.append(entry)
            counts[key] += 1
    entries = selected
    result.update(matchedVenues=len({entry['query']['id'] for entry in entries}),
                  additionalWebsiteCandidateVenues=len({entry['query']['id'] for entry in entries if not entry['mappedWebsitePresent']}),
                  candidateRecords=len(entries), receivedBodyBytes=budget.received,
                  reservedBodyBytes=budget.reserved, requests=budget.requests,
                  seconds=round(time.monotonic() - budget.began, 2))
    write_candidates(output, entries, result)
    Path(summary_path).parent.mkdir(parents=True, exist_ok=True)
    Path(summary_path).write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, sort_keys=True), flush=True)
    if failure is not None:
        raise failure
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--venues-dir', default='public/data/venues')
    parser.add_argument('--output', default='work/overture/website-candidates.json.gz')
    parser.add_argument('--summary', default='work/overture/summary.json')
    parser.add_argument('--max-bytes', type=int, default=MAX_BYTES)
    parser.add_argument('--max-seconds', type=int, default=1100)
    args = parser.parse_args()
    if not 1 <= args.max_bytes <= MAX_BYTES or not 1 <= args.max_seconds <= 1100:
        parser.error('Maximum download is 2 GiB and maximum runtime is 1100 seconds')
    run_audit(args.venues_dir, args.output, args.summary, args.max_bytes, args.max_seconds)


if __name__ == '__main__':
    main()
