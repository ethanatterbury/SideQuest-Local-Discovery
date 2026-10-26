const areas = {
  Newcastle: [54.9783, -1.6178],
  Manchester: [53.4808, -2.2426],
  York: [53.959, -1.0815],
  Birmingham: [52.4862, -1.8904],
  Norwich: [52.63, 1.297],
  London: [51.5074, -0.1278],
  Exeter: [50.7184, -3.5339],
  Penzance: [50.118, -5.537],
};
function km(a, b) {
  const r = Math.PI / 180,
    h =
      Math.sin(((b[0] - a[0]) * r) / 2) ** 2 +
      Math.cos(a[0] * r) *
        Math.cos(b[0] * r) *
        Math.sin(((b[1] - a[1]) * r) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** A release smoke gate, not proof of complete or current venue coverage. */
export function englandCoverage(data) {
  const records = (data.elements ?? []).filter(
    (e) => e.tags?.name || e.tags?.["name:en"],
  );
  const counts = Object.fromEntries(
    Object.keys(areas).map((name) => [name, 0]),
  );
  for (const e of records) {
    const p = [e.lat ?? e.center?.lat, e.lon ?? e.center?.lon];
    if (!p.every(Number.isFinite)) continue;
    for (const [name, center] of Object.entries(areas))
      if (km(p, center) <= 35) counts[name]++;
  }
  const englandSource = (data.sources ?? []).includes(
    "https://download.geofabrik.de/europe/united-kingdom/england-latest.osm.pbf",
  );
  const missingAreas = Object.keys(areas).filter((name) => counts[name] < 10);
  return {
    ready: englandSource && records.length >= 10000 && !missingAreas.length,
    englandSource,
    records: records.length,
    areaCounts: counts,
    missingAreas,
    checkedAt: new Date().toISOString(),
  };
}
