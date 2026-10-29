#!/usr/bin/env python3
"""Stream the free Geograph metadata dumps into conservative venue candidates.

No image requests, API key, scraped pages or Geograph image hotlinks. Primary
schema/format: https://data.geograph.org.uk/dumps/columns.html and /dumps/.
"""
import argparse
from collections import defaultdict
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import sqlite3
import tempfile
import time
import unicodedata
import urllib.request

BASE_COLUMNS = ('gridimage_id', 'user_id', 'realname', 'title', 'moderation_status',
                'imagetaken', 'grid_reference', 'x', 'y', 'wgs84_lat', 'wgs84_long', 'reference_index')
GEO_COLUMNS = ('gridimage_id', 'nateastings', 'natnorthings', 'natgrlen',
               'viewpoint_eastings', 'viewpoint_northings', 'viewpoint_grlen', 'view_direction', 'use6fig')
BASE_TYPES = ('int(11)', 'int(11)', 'varchar(128)', 'varchar(128)',
              "enum('rejected','pending','accepted','geograph')", 'date', 'varchar(6)',
              'smallint(3)', 'smallint(4)', 'decimal(10,6)', 'decimal(10,6)', 'tinyint(1)')
GEO_TYPES = ('int(11)', 'mediumint(8)', 'mediumint(8)', "enum('10','8','6','4','2')",
             'mediumint(8)', 'mediumint(8)', "enum('10','8','6','4','2','0')", 'smallint(6)', 'tinyint(3)')
SOURCE_ROOT = 'https://data.geograph.org.uk/dumps/'
LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/2.0/'
STOPWORDS = set('the a an and of at in on for to saint st park parks garden gardens country '
                'nature reserve national royal museum gallery hall town village city community '
                'leisure centre center playground play area playing field fields recreation ground '
                'memorial common green sports sport club house visitor attraction viewpoint '
                'swimming pool adventure golf miniature crazy mini cinema theatre theater '
                'north south east west central heritage public local old new '
                'church chapel cathedral abbey castle zoo aquarium station lake valley woods forest '
                'wood beach monument sculpture statue tower mill farm barn building ruin ruins exhibition '
                'waterpark aquapark trampoline bowling rink skatepark skate boardwalk'.split())
RELATIONSHIP = re.compile(r'\b(?:near|towards?|road|roads|lane|lanes|parking|car park|carpark|'
                          r'access|approach|entrance|exit|footpath|path|track|driveway|'
                          r'opposite|beside|behind|adjacent|outside|from|overlooking|sign|signpost)\b')
ESCAPES = {'t': '\t', 'n': '\n', 'r': '\r', '0': '\0', 'b': '\b', 'Z': '\x1a', '\\': '\\'}


def unescape_mysql(value):
    if value == r'\N':
        return None
    return re.sub(r'\\(.)', lambda m: ESCAPES.get(m[1], m[1]), value)


def normalize(value):
    value = ''.join(c for c in unicodedata.normalize('NFKD', value.lower()) if not unicodedata.combining(c))
    return ' '.join(re.sub(r'[^\w]+', ' ', value.replace('&', ' and ').replace('+', ' and '), flags=re.UNICODE).replace('_', ' ').split())


def normalized_name(value):
    value = normalize(value)
    return value[4:] if value.startswith('the ') else value


def distinctive(name):
    words = [w for w in name.split() if w not in STOPWORDS and not w.isdecimal()]
    return any(len(w) >= 5 for w in words) or len({w for w in words if len(w) >= 3}) >= 2


def query_identity(query):
    # Same stable id/name/location inputs as websiteDiscoveryIdentity in the app.
    name = ''.join(c for c in unicodedata.normalize('NFD', query['name'].lower()) if not unicodedata.combining(c))
    name = ''.join(c for c in name.replace('&', 'and').replace('+', 'and') if c.isalnum())
    def fixed(value):
        # JS toFixed rounds the exact binary float with ties away from zero.
        value = float(value) or 0.0
        return format(Decimal.from_float(value).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP), '.4f')
    return json.dumps([query['id'], name, fixed(query['lat']), fixed(query['lng'])], ensure_ascii=False, separators=(',', ':'))


def validate_schema(text, expected):
    fields = re.findall(r'^\s*`([^`]+)`\s+(\w+(?:\([^)]*\))?)', text, flags=re.MULTILINE)
    columns = tuple(field[0] for field in fields)
    types = tuple(re.sub(r'\s+', '', field[1].lower()) for field in fields)
    expected_types = BASE_TYPES if tuple(expected) == BASE_COLUMNS else GEO_TYPES
    if columns != tuple(expected) or types != expected_types:
        raise ValueError(f'Dump schema changed: expected {tuple(zip(expected, expected_types))}, received {fields}')


def integer(value, label, minimum=None, maximum=None):
    if not re.fullmatch(r'-?\d+', value or ''):
        raise ValueError(f'Invalid {label}: {value!r}')
    number = int(value)
    if (minimum is not None and number < minimum) or (maximum is not None and number > maximum):
        raise ValueError(f'Out-of-range {label}: {value!r}')
    return number


def tsv_rows(path, columns, max_uncompressed_bytes=4 * 1024**3, encoding='latin-1'):
    """MySQL TSV with optional exact first-line header; split before unescaping."""
    total = 0
    with gzip.open(path, 'rb') as source:
        for line_number in range(1, 12_000_001):
            line = source.readline(65537)
            if not line:
                return
            total += len(line)
            if len(line) > 65536 or total > max_uncompressed_bytes:
                raise ValueError(f'{path}: decompressed metadata exceeds processing quota')
            try:
                values = line.rstrip(b'\n').rstrip(b'\r').decode(encoding).split('\t')
            except UnicodeDecodeError as exc:
                raise ValueError(f'{path}:{line_number}: invalid {encoding}; select documented encoding explicitly') from exc
            if line_number == 1 and tuple(values) == tuple(columns):
                continue
            if len(values) != len(columns):
                raise ValueError(f'{path}:{line_number}: expected {len(columns)} columns, received {len(values)}')
            row = dict(zip(columns, (unescape_mysql(x) for x in values)))
            integer(row['gridimage_id'], 'gridimage_id', 1)
            yield row
        if source.read(1):
            raise ValueError(f'{path}: row count exceeds processing quota')


def distance_m(lat, lng, other_lat, other_lng):
    a, b = math.radians(lat), math.radians(other_lat)
    h = math.sin((b - a) / 2)**2 + math.cos(a) * math.cos(b) * math.sin(math.radians(other_lng - lng) / 2)**2
    return 6371008.8 * 2 * math.asin(min(1, math.sqrt(h)))


def cell(lat, lng):
    return math.floor(lat / .002), math.floor(lng / .004)


def load_venues(directory):
    grid, queries = defaultdict(list), {}
    for path in sorted(Path(directory).glob('*.json')):
        if not re.fullmatch(r'\d+_-?\d+\.json', path.name):
            continue
        data = json.loads(path.read_text())
        for place in data.get('places', []):
            if 'optionalCategory' in place:
                continue
            query = {'id': place['id'], 'name': place['name'],
                     'lat': place['coordinates']['lat'], 'lng': place['coordinates']['lng']}
            if not all(isinstance(query[key], (int, float)) and math.isfinite(query[key]) for key in ('lat', 'lng')):
                raise ValueError('Invalid venue coordinates')
            if query['id'] in queries:
                if query != queries[query['id']]:
                    raise ValueError('Conflicting venue identity')
                continue
            queries[query['id']] = query
            name = normalized_name(query['name'])
            if distinctive(name):
                grid[cell(query['lat'], query['lng'])].append((query, name))
    if not queries:
        raise ValueError('No default venues found; run npm run prepare:data first')
    return grid, queries


def nearby_matches(grid, title, lat, lng):
    title = ' ' + normalize(title) + ' '
    matches = []
    cy, cx = cell(lat, lng)
    for y in range(cy - 1, cy + 2):
        for x in range(cx - 1, cx + 2):
            for query, name in grid.get((y, x), ()):
                phrase = ' ' + name + ' '
                if phrase not in title:
                    continue
                distance = distance_m(lat, lng, query['lat'], query['lng'])
                if distance > 150:
                    continue
                # Remove the actual name first: e.g. "Royal Road Museum" is a name.
                remainder = title.replace(phrase, ' ')
                if not RELATIONSHIP.search(remainder):
                    matches.append((query, name, distance))
    return matches


def file_evidence(path, table):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return {'url': SOURCE_ROOT + table + '.tsv.gz', 'sha256': digest.hexdigest(),
            'compressedBytes': Path(path).stat().st_size}


def build_matches(venues_dir, base_path, geo_path, output, *, max_uncompressed_bytes=4 * 1024**3,
                  max_candidates=250_000, encoding='latin-1'):
    started = time.monotonic()
    grid, queries = load_venues(venues_dir)
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    stats = {'defaultVenues': len(queries), 'baseRows': 0, 'geoRows': 0, 'nameSpatialCandidates': 0}
    ids, best = set(), defaultdict(list)
    with tempfile.TemporaryDirectory(prefix='geograph-matches-', dir=output.parent) as temporary:
        db = sqlite3.connect(str(Path(temporary) / 'candidates.sqlite'))
        try:
            db.execute('PRAGMA journal_mode=OFF')
            db.execute('PRAGMA max_page_count=65536')  # 256 MiB disk; never import the full mirror.
            db.execute('CREATE TABLE candidates (id INTEGER PRIMARY KEY, body TEXT NOT NULL)')
            for row in tsv_rows(base_path, BASE_COLUMNS, max_uncompressed_bytes, encoding):
                stats['baseRows'] += 1
                if stats['baseRows'] % 1_000_000 == 0:
                    print(json.dumps({'phase': 'base', 'rows': stats['baseRows'], 'candidates': len(ids),
                                      'seconds': round(time.monotonic() - started, 1)}), flush=True)
                # Validate relevant base types before filtering; schema drift must fail closed.
                photo_id = int(row['gridimage_id'])
                user_id = integer(row['user_id'], 'user_id', 1)
                reference_index = integer(row['reference_index'], 'reference_index', 1, 2)
                try:
                    lat, lng = float(row['wgs84_lat']), float(row['wgs84_long'])
                except (ValueError, TypeError) as exc:
                    raise ValueError('Invalid subject coordinates') from exc
                if not (math.isfinite(lat) and math.isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180):
                    raise ValueError('Invalid subject coordinates')
                if row['moderation_status'] not in ('accepted', 'geograph'):
                    raise ValueError('Unexpected moderation status in active dump')
                if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', row['imagetaken'] or ''):
                    raise ValueError('Invalid image taken date')
                year, month, day = map(int, row['imagetaken'].split('-'))
                if year:
                    try:
                        if date(year, month or 1, day or 1) > date.today():
                            continue
                    except ValueError:
                        continue
                elif month or day:
                    continue
                if reference_index != 1 or not row['title'] or not row['realname']:
                    continue
                matches = nearby_matches(grid, row['title'], lat, lng)
                if len(matches) != 1:
                    continue
                if len(ids) >= max_candidates:
                    raise ValueError('Name/spatial candidates exceed processing quota')
                if photo_id in ids:
                    raise ValueError('Duplicate Geograph base ID')
                query, name, distance = matches[0]
                candidate = {'status': 'candidate', 'geographId': photo_id, 'title': row['title'],
                             'photographer': row['realname'], 'photographerId': user_id,
                             'photoTaken': row['imagetaken'], 'coordinates': {'lat': lat, 'lng': lng},
                             'pageUrl': f'https://www.geograph.org.uk/photo/{photo_id}',
                             'license': 'CC BY-SA 2.0', 'licenseUrl': LICENSE_URL,
                             'evidence': {'normalizedVenueName': name, 'nameMatch': 'full-normalized-phrase',
                                          'distanceMetres': round(distance, 2), 'coordinateRole': 'subject',
                                          'uniqueNearbyVenue': True}}
                db.execute('INSERT INTO candidates VALUES (?, ?)',
                           (photo_id, json.dumps([query['id'], candidate], ensure_ascii=False, separators=(',', ':'))))
                ids.add(photo_id)
                if stats['baseRows'] % 100_000 == 0:
                    db.commit()
            db.commit()
            stats['nameSpatialCandidates'] = len(ids)
            seen = set()
            for row in tsv_rows(geo_path, GEO_COLUMNS, max_uncompressed_bytes, encoding):
                stats['geoRows'] += 1
                if stats['geoRows'] % 1_000_000 == 0:
                    print(json.dumps({'phase': 'geo', 'rows': stats['geoRows'], 'matchedVenues': len(best),
                                      'seconds': round(time.monotonic() - started, 1)}), flush=True)
                photo_id = int(row['gridimage_id'])
                if photo_id not in ids:
                    continue
                if photo_id in seen:
                    raise ValueError('Duplicate Geograph geo ID')
                seen.add(photo_id)
                digits = integer(row['natgrlen'], 'natgrlen')
                privacy = integer(row['use6fig'], 'use6fig', 0, 255)
                east = integer(row['nateastings'], 'nateastings', 0)
                north = integer(row['natnorthings'], 'natnorthings', 0)
                if digits not in (2, 4, 6, 8, 10):
                    raise ValueError('Unexpected subject precision')
                if digits < 8 or privacy != 0 or east == 0 or north == 0:
                    continue
                query_id, candidate = json.loads(db.execute('SELECT body FROM candidates WHERE id=?', (photo_id,)).fetchone()[0])
                candidate['subjectPrecision'] = {'digits': digits, 'metres': 10 ** (5 - digits // 2)}
                ranked = best[query_id]
                ranked.append(candidate)
                ranked.sort(key=lambda p: (-int(p['photoTaken'].replace('-', '')),
                                          -p['subjectPrecision']['digits'], p['evidence']['distanceMetres'], p['geographId']))
                del ranked[3:]
        finally:
            db.close()
        entries = [{'query': queries[key], 'identity': query_identity(queries[key]), 'candidates': best[key]}
                   for key in sorted(best)]
        result = {'version': 1, 'status': 'candidates', 'copyright': 'Geograph Project and individual photographers',
                  'catalogueCopyright': 'OpenStreetMap contributors, ODbL 1.0',
                  'license': 'CC BY-SA 2.0', 'licenseUrl': LICENSE_URL,
                  'sources': [file_evidence(base_path, 'gridimage_base'), file_evidence(geo_path, 'gridimage_geo')],
                  'criteria': {'maximumDistanceMetres': 150, 'minimumSubjectGridDigits': 8,
                               'maximumPerVenue': 3, 'requireUnrestrictedSubjectPosition': True}, 'entries': entries}
        staged = Path(temporary) / 'matches.json.gz'
        with staged.open('wb') as raw:
            with gzip.GzipFile(fileobj=raw, mode='wb', filename='', mtime=0) as stream:
                stream.write(json.dumps(result, ensure_ascii=False, separators=(',', ':')).encode())
        staged.replace(output)
    stats.update(matchedVenues=len(best), candidates=sum(map(len, best.values())),
                 seconds=round(time.monotonic() - started, 2), outputBytes=output.stat().st_size)
    return stats


def download(url, destination, maximum):
    """Bounded atomic fixed-source download. Complete cached files can resume reruns."""
    destination = Path(destination)
    if destination.exists():
        if destination.stat().st_size > maximum:
            raise ValueError('Cached metadata exceeds download quota')
        return
    temporary = destination.with_suffix(destination.suffix + '.partial')
    request = urllib.request.Request(url, headers={'User-Agent': 'SideQuest-free-Geograph-metadata-import/1.0'})
    try:
        with urllib.request.urlopen(request, timeout=60) as source, temporary.open('wb') as target:
            if source.headers.get('Content-Length') and int(source.headers['Content-Length']) > maximum:
                raise ValueError('Metadata exceeds configured download quota')
            count = 0
            while chunk := source.read(min(1024 * 1024, maximum - count + 1)):
                count += len(chunk)
                if count > maximum:
                    raise ValueError('Metadata exceeds configured download quota')
                target.write(chunk)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--venues-dir', default='public/data/venues')
    parser.add_argument('--output', default='src/providers/data/geograph-venue-matches.json.gz')
    parser.add_argument('--work-dir', default='work/geograph')
    parser.add_argument('--download', action='store_true', help='Download only the two fixed official metadata dumps and schemas')
    parser.add_argument('--base-tsv', type=Path)
    parser.add_argument('--geo-tsv', type=Path)
    parser.add_argument('--max-file-mb', type=int, default=512)
    parser.add_argument('--max-total-mb', type=int, default=1024)
    parser.add_argument('--encoding', choices=('utf-8', 'latin-1'), default='latin-1')
    args = parser.parse_args()
    if min(args.max_file_mb, args.max_total_mb) <= 0:
        parser.error('Download quotas must be positive')
    paths = [args.base_tsv, args.geo_tsv]
    if args.download:
        if any(paths):
            parser.error('--download cannot be combined with local TSV arguments')
        work = Path(args.work_dir)
        work.mkdir(parents=True, exist_ok=True)
        total = 0
        paths = []
        for table, columns in [('gridimage_base', BASE_COLUMNS), ('gridimage_geo', GEO_COLUMNS)]:
            schema = work / (table + '.schema')
            download(SOURCE_ROOT + table + '.schema', schema, 65536)
            validate_schema(schema.read_text(encoding='utf-8'), columns)
            destination = work / (table + '.tsv.gz')
            remaining = args.max_total_mb * 1024**2 - total
            download(SOURCE_ROOT + table + '.tsv.gz', destination,
                     min(args.max_file_mb * 1024**2, remaining))
            total += destination.stat().st_size
            print(json.dumps({'metadataFile': destination.name, 'compressedBytes': destination.stat().st_size}), flush=True)
            paths.append(destination)
    if not all(paths):
        parser.error('Use --download or provide both --base-tsv and --geo-tsv')
    if any(p.stat().st_size > args.max_file_mb * 1024**2 for p in paths) or sum(p.stat().st_size for p in paths) > args.max_total_mb * 1024**2:
        parser.error('Local files exceed metadata quota')
    summary = build_matches(args.venues_dir, *paths, args.output, encoding=args.encoding)
    print(json.dumps(summary, sort_keys=True), flush=True)


if __name__ == '__main__':
    main()
