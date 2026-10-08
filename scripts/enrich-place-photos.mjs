/** Generate resumable venue media independently of recommendation ordering. */
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
const args = Object.fromEntries(
  process.argv.slice(2).map((v) => {
    const at = v.indexOf("=");
    return [v.slice(2, at), v.slice(at + 1)];
  }),
);
const base = new URL(args.base || "http://localhost:3000");
const output = args.output || "src/providers/data/place-photo-index.json";
const source = JSON.parse(
  await readFile(args.input || "work/photo-sample.json", "utf8"),
);
const sample = (source.places || source).slice(0, Number(args.limit || 200));
let index;
try {
  index = JSON.parse(await readFile(output, "utf8"));
} catch {
  index = { version: 2, generatedAt: null, sample: null, entries: [] };
}
const identity = (q) =>
  JSON.stringify([
    q.id,
    q.name.toLowerCase().trim(),
    q.lat,
    q.lng,
    q.wikidata,
    q.wikipedia,
    q.osmImage,
    q.commons,
    q.aliases || [],
  ]);
const queryOf = (p) => ({
  id: p.id,
  name: p.name,
  lat: p.coordinates.lat,
  lng: p.coordinates.lng,
  area: p.area,
  category: p.category,
  aliases: p.aliases,
  wikidata: p.wikidata,
  wikipedia: p.wikipedia,
  osmImage: p.osmImage,
  commons: p.commons,
  website: p.website,
});
const queries = sample.map(queryOf);
const existing = new Map(index.entries.map((e) => [identity(e.query), e]));
const todo = queries
  .filter((q) => {
    const e = existing.get(identity(q));
    return !e || e.retryable || args.refresh === "true";
  })
  .slice(0, Number(args.batch || 200));
let cursor = 0;
let checkpoints = Promise.resolve();
async function checkpoint() {
  index.entries = [...existing.values()];
  index.generatedAt = new Date().toISOString();
  const tested = queries.map((q) => existing.get(identity(q))).filter(Boolean);
  index.sample = {
    label:
      args.label ||
      "200 nearby catalogue places · Sandhurst · selection independent of photos",
    tested: tested.length,
    matched: tested.filter((e) => e.image).length,
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(`${output}.partial`, JSON.stringify(index));
  await rename(`${output}.partial`, output);
}
async function worker() {
  while (cursor < todo.length) {
    const query = todo[cursor++];
    const params = new URLSearchParams({
      debug: "1",
      ...(args.refresh === "true" ? { refresh: "1" } : {}),
    });
    for (const [k, v] of Object.entries(query))
      if (v !== undefined)
        params.set(k, Array.isArray(v) ? JSON.stringify(v) : String(v));
    const url = new URL(`/api/photo?${params}`, base);
    if (process.env.SIDEQUEST_PREVIEW_SHARE)
      url.searchParams.set("share", process.env.SIDEQUEST_PREVIEW_SHARE);
    let result;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      result = await response.json();
    } catch (e) {
      result = {
        image: null,
        retryable: true,
        diagnostics: {
          strategy: null,
          sourcesAttempted: [],
          candidateCount: 0,
          rejected: { [String(e.message)]: 1 },
          requestCount: 0,
          elapsedMs: 0,
        },
      };
    }
    existing.set(identity(query), {
      query,
      checkedAt: new Date().toISOString(),
      image: result.image || null,
      retryable: result.retryable,
      diagnostics: result.diagnostics,
    });
    checkpoints = checkpoints.then(checkpoint);
    await checkpoints;
    console.log(
      `${query.id}\t${query.name}\t${result.image ? "matched" : result.retryable ? "retryable" : "unresolved"}`,
    );
  }
}
await Promise.all(
  Array.from({ length: Math.min(3, Number(args.concurrency || 3)) }, worker),
);
await checkpoint();
console.log(JSON.stringify(index.sample));
