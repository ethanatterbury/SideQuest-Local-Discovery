import { afterEach, expect, it, vi } from "vitest";
import {
  resolveGeographCommonsPhoto as resolveWithProductionPacing,
  type GeographCommonsOptions,
} from "../src/providers/geograph-commons-photo";
import { approvedPhoto } from "../src/providers/photo-policy";

const id = "57771";
const checkedAt = "2026-10-28T00:00:00Z";
const original =
  "https://upload.wikimedia.org/wikipedia/commons/a/ab/NS6469_harvest.jpg";
const thumb =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/NS6469_harvest.jpg/960px-NS6469_harvest.jpg";
function resolveGeographCommonsPhoto(
  geographId: number | string,
  options: GeographCommonsOptions = {},
) {
  let fixtureTime = 0;
  return resolveWithProductionPacing(geographId, {
    expectedTitle: "Harvest",
    pacing: {
      now: () => fixtureTime,
      pause: async (delayMs: number) => {
        fixtureTime += delayMs;
      },
    },
    ...options,
  });
}
function page(pageid = 101) {
  return {
    pageid,
    ns: 6,
    title: "File:NS6469 harvest.jpg",
    imageinfo: [
      {
        url: original,
        thumburl: thumb,
        descriptionurl:
          "https://commons.wikimedia.org/wiki/File:NS6469_harvest.jpg",
        width: 1600,
        height: 1200,
        thumbwidth: 960,
        thumbheight: 720,
        mime: "image/jpeg",
        extmetadata: {
          Artist: {
            value:
              '<a href="https://www.geograph.org.uk/profile/1">Anne &amp; John Smith</a>',
          },
          Credit: {
            value:
              '<a href="http://www.geograph.org.uk/photo/57771">From geograph.org.uk</a>',
          },
          ImageDescription: { value: "Harvest near the old park" },
          LicenseShortName: { value: "CC BY-SA 2.0" },
        },
      },
    ],
  };
}
function entity(value: unknown = id) {
  return {
    type: "mediainfo",
    id: "M101",
    statements: {
      P7384: [
        {
          rank: "normal",
          mainsnak: { snaktype: "value", datavalue: { value, type: "string" } },
        },
      ],
    },
  };
}
function transport(responses: (unknown | Response)[]) {
  return vi.fn<typeof fetch>().mockImplementation(async () => {
    const data = responses.shift() ?? { query: { exturlusage: [] } };
    return data instanceof Response ? data : Response.json(data);
  });
}
function primary(candidate = page(), sourceEntity = entity()) {
  return transport([
    { query: { pages: [candidate] } },
    { entities: { M101: sourceEntity } },
  ]);
}
function usage(
  source = `http://www.geograph.org.uk/photo/${id}`,
  pageid = 101,
) {
  return { pageid, ns: 6, title: "File:NS6469 harvest.jpg", url: source };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("identifies a renamed Commons file by agreeing source link and structured ID, preserving reusable attribution", async () => {
  const fetcher = primary();
  const result = await resolveGeographCommonsPhoto(id, {
    fetch: fetcher,
    checkedAt,
    expectedPhotographer: "A. & J. Smith",
    expectedTitle: "Harvest",
  });
  expect(result).toMatchObject({
    reason: "matched",
    retryable: false,
    requestCount: 2,
    image: {
      url: thumb,
      source: "https://commons.wikimedia.org/wiki/File:NS6469_harvest.jpg",
      credit: "Anne & John Smith",
      license: "CC BY-SA 2.0",
      width: 960,
      height: 720,
      strategy: "geograph-commons-source-id",
      rights: "open",
      checkedAt,
    },
    evidence: {
      geographId: id,
      lookup: "file-title",
      commonsPageId: 101,
      sourceUrl: `https://www.geograph.org.uk/photo/${id}`,
      structuredIds: [id],
      warnings: [],
    },
  });
  expect(approvedPhoto(result.image)?.url).toBe(thumb);
  expect(result.image?.matched).toEqual([
    "exact-geograph-source-id",
    "structured-geograph-id",
  ]);
  for (const [url, options] of fetcher.mock.calls) {
    const request = new URL(String(url));
    expect(request.origin + request.pathname).toBe(
      "https://commons.wikimedia.org/w/api.php",
    );
    expect(request.searchParams.get("maxlag")).toBe("5");
    expect(options).toMatchObject({
      redirect: "error",
      cache: "no-store",
      headers: {
        "User-Agent": expect.stringContaining("contact https://github.com/"),
      },
    });
  }
  const discovery = new URL(String(fetcher.mock.calls[0][0]));
  expect(discovery.searchParams.get("titles")).toBe(
    `File:Harvest - geograph.org.uk - ${id}.jpg`,
  );
  expect(discovery.searchParams.get("redirects")).toBe("1");
  expect(discovery.searchParams.get("generator")).toBeNull();
  expect(discovery.searchParams.has("gsrsearch")).toBe(false);
});

it("uses the source URL index directly when a safe filename guess is unavailable", async () => {
  for (const expectedTitle of [
    undefined,
    "",
    "A|File:Other.jpg",
    "Bad\nName",
    "Bad[Name]",
    "a".repeat(256),
    "界".repeat(100),
  ]) {
    const fetcher = transport([
      { query: { exturlusage: [usage()] } },
      { query: { pages: [page()] } },
      { entities: { M101: entity() } },
    ]);
    const result = await resolveGeographCommonsPhoto(id, {
      fetch: fetcher,
      expectedTitle,
    });
    expect(result).toMatchObject({
      reason: "matched",
      requestCount: 3,
      evidence: { lookup: "source-url" },
    });
    expect(result.evidence.warnings).toContain("file-title-unavailable");
    for (const [url] of fetcher.mock.calls) {
      const query = new URL(String(url)).searchParams;
      expect(query.has("titles")).toBe(false);
      expect(query.has("generator")).toBe(false);
      expect(query.has("gsrsearch")).toBe(false);
    }
  }
});

it("follows a filename redirect but still requires an exact source link and checks any SDC ID", async () => {
  const renamed = {
    query: {
      redirects: [
        {
          from: "File:Harvest - geograph.org.uk - 57771.jpg",
          to: page().title,
        },
      ],
      pages: [page()],
    },
  };
  const fetcher = transport([
    renamed,
    { entities: { M101: { id: "M101", missing: true } } },
  ]);
  expect(
    await resolveGeographCommonsPhoto(id, { fetch: fetcher }),
  ).toMatchObject({
    reason: "matched",
    requestCount: 2,
    evidence: { lookup: "file-title", structuredIds: [] },
  });
  const wrongSource = page();
  wrongSource.imageinfo[0].extmetadata.Credit.value = "The filename says 57771";
  expect(
    await resolveGeographCommonsPhoto(id, { fetch: primary(wrongSource) }),
  ).toMatchObject({ image: null, reason: "missing-source-evidence" });
});

it("finds a renamed file through exact source URL lookup after a missing guessed file", async () => {
  const fetcher = transport([
    {
      query: {
        pages: [
          {
            ns: 6,
            title: "File:Harvest - geograph.org.uk - 57771.jpg",
            missing: true,
          },
        ],
      },
    },
    { query: { exturlusage: [usage()] } },
    { query: { pages: [page()] } },
    { entities: { M101: entity() } },
  ]);
  expect(
    await resolveGeographCommonsPhoto(id, { fetch: fetcher }),
  ).toMatchObject({
    reason: "matched",
    requestCount: 4,
    evidence: { lookup: "source-url", commonsTitle: "File:NS6469 harvest.jpg" },
  });
});

it("accepts the observed Minehead Commons payload and strips only its cosmetic UTM parameters", async () => {
  const minehead = page();
  const filename =
    "Interior%2C_Minehead_Museum_-_geograph.org.uk_-_7319896.jpg";
  const cleanUrl = `https://upload.wikimedia.org/wikipedia/commons/4/4a/${filename}`;
  minehead.title =
    "File:Interior, Minehead Museum - geograph.org.uk - 7319896.jpg";
  Object.assign(minehead.imageinfo[0], {
    url: `${cleanUrl}?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original`,
    thumburl: `${cleanUrl}?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail_unscaled`,
    descriptionurl:
      "https://commons.wikimedia.org/wiki/File:Interior,_Minehead_Museum_-_geograph.org.uk_-_7319896.jpg",
    width: 640,
    height: 480,
    thumbwidth: 640,
    thumbheight: 480,
  });
  minehead.imageinfo[0].extmetadata.Credit.value =
    '<a href="https://www.geograph.org.uk/photo/7319896">From Geograph</a>';
  const fetcher = primary(minehead, entity("7319896"));
  const result = await resolveGeographCommonsPhoto("7319896", {
    fetch: fetcher,
    checkedAt,
    expectedTitle: "Interior, Minehead Museum",
  });
  expect(result).toMatchObject({
    reason: "matched",
    requestCount: 2,
    image: { url: cleanUrl, width: 640, height: 480, license: "CC BY-SA 2.0" },
  });
  expect(approvedPhoto(result.image)?.url).toBe(cleanUrl);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(
    new URL(String(fetcher.mock.calls[0][0])).searchParams.get("titles"),
  ).toBe("File:Interior, Minehead Museum - geograph.org.uk - 7319896.jpg");
});

it("accepts the observed scaled Harbour Screen thumbnail on the official Commons thumb host", async () => {
  const harbour = page();
  const filename = "The_Harbour_Screen_-_geograph.org.uk_-_6225569.jpg";
  const originalUrl = `https://upload.wikimedia.org/wikipedia/commons/7/75/${filename}`;
  const thumbnailUrl = `https://thumb.wikimedia.org/wikipedia/commons/thumb/7/75/${filename}/960px-${filename}`;
  const tracking =
    "utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=";
  harbour.title = "File:The Harbour Screen - geograph.org.uk - 6225569.jpg";
  Object.assign(harbour.imageinfo[0], {
    url: `${originalUrl}?${tracking}original`,
    thumburl: `${thumbnailUrl}?${tracking}thumbnail`,
    descriptionurl: `https://commons.wikimedia.org/wiki/File:${filename}`,
  });
  harbour.imageinfo[0].extmetadata.Credit.value =
    '<a href="https://www.geograph.org.uk/photo/6225569">From Geograph</a>';
  const fetcher = primary(harbour, entity("6225569"));
  const result = await resolveGeographCommonsPhoto("6225569", {
    fetch: fetcher,
    checkedAt,
    expectedTitle: "The Harbour Screen",
  });
  expect(result).toMatchObject({
    reason: "matched",
    requestCount: 2,
    image: {
      url: thumbnailUrl,
      source: `https://commons.wikimedia.org/wiki/File:${filename}`,
    },
    evidence: { lookup: "file-title", structuredIds: ["6225569"] },
  });
  expect(approvedPhoto(result.image)?.url).toBe(thumbnailUrl);
});

it("rejects spoofed thumbnail authorities, explicit ports and non-thumbnail paths on the thumb host", async () => {
  for (const url of [
    "https://thumb.wikimedia.org.evil.test/wikipedia/commons/thumb/a/ab/Test.jpg/960px-Test.jpg",
    "https://thumb.wikimedia.org/wikipedia/commons/a/ab/Test.jpg",
    "http://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Test.jpg/960px-Test.jpg",
    "https://thumb.wikimedia.org:443/wikipedia/commons/thumb/a/ab/Test.jpg/960px-Test.jpg",
    "https://user@thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Test.jpg/960px-Test.jpg",
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Test.jpg/960px-Test.jpg?utm_source=commons.wikimedia.org&width=960",
  ]) {
    const candidate = page();
    candidate.imageinfo[0].thumburl = url;
    expect(
      await resolveGeographCommonsPhoto(id, {
        fetch: primary(candidate),
        checkedAt,
      }),
    ).toMatchObject({
      image: null,
      reason: "unsafe-image-url",
      requestCount: 2,
    });
  }
});

it("rejects unknown CDN query parameters without falling back after source identity is established", async () => {
  for (const query of [
    "width=960",
    "utm_source=commons.wikimedia.org&url=https://evil.test",
    "utm_content=original&token=secret",
  ]) {
    const candidate = page();
    candidate.imageinfo[0].thumburl += `?${query}`;
    const fetcher = primary(candidate);
    expect(
      await resolveGeographCommonsPhoto(id, { fetch: fetcher, checkedAt }),
    ).toMatchObject({
      image: null,
      reason: "unsafe-image-url",
      requestCount: 2,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  }
});

it("does not repeat discovery after finding an exact source with unusable credit or license", async () => {
  for (const [field, reason] of [
    ["Artist", "missing-credit"],
    ["LicenseShortName", "non-open-license"],
  ] as const) {
    const candidate = page();
    candidate.imageinfo[0].extmetadata[field].value = "";
    const fetcher = primary(candidate);
    expect(
      await resolveGeographCommonsPhoto(id, { fetch: fetcher, checkedAt }),
    ).toMatchObject({ image: null, reason, requestCount: 2 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  }
});

it("reports CirrusSearch overload as retryable with a bounded backoff and no fallback requests", async () => {
  const fetcher = transport([
    {
      error: {
        code: "cirrussearch-too-busy-error",
        info: "Query service overloaded",
      },
    },
  ]);
  expect(
    await resolveGeographCommonsPhoto(id, { fetch: fetcher }),
  ).toMatchObject({
    image: null,
    reason: "api-cirrussearch-too-busy-error",
    retryable: true,
    retryAfterMs: 60000,
    requestCount: 1,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("paces every request across concurrent lookups even when fetch is injected", async () => {
  vi.useFakeTimers();
  const starts: number[] = [];
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    starts.push(Date.now());
    return Response.json(
      new URL(String(url)).searchParams.get("action") === "wbgetentities"
        ? { entities: { M101: entity() } }
        : { query: { pages: [page()] } },
    );
  });
  const work = Promise.all([
    resolveWithProductionPacing(id, {
      fetch: fetcher,
      timeoutMs: 5000,
      expectedTitle: "Harvest",
    }),
    resolveWithProductionPacing(id, {
      fetch: fetcher,
      timeoutMs: 5000,
      expectedTitle: "Harvest",
    }),
  ]);
  await vi.advanceTimersByTimeAsync(2100);
  expect((await work).every((result) => result.reason === "matched")).toBe(
    true,
  );
  expect(starts).toHaveLength(4);
  expect(starts.slice(1).map((value, index) => value - starts[index])).toEqual([
    650, 650, 650,
  ]);
});

it("cancels a queued lookup at its deadline without issuing a request or breaking the shared pace", async () => {
  vi.useFakeTimers();
  const pacing = {
    now: () => Date.now(),
    pause: (delayMs: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, delayMs)),
  };
  const starts: number[] = [];
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    starts.push(Date.now());
    return Response.json(
      new URL(String(url)).searchParams.get("action") === "wbgetentities"
        ? { entities: { M101: entity() } }
        : { query: { pages: [page()] } },
    );
  });
  const first = resolveWithProductionPacing(id, {
    fetch: fetcher,
    timeoutMs: 5000,
    pacing,
    expectedTitle: "Harvest",
  });
  const cancelled = resolveWithProductionPacing(id, {
    fetch: fetcher,
    timeoutMs: 50,
    pacing,
    expectedTitle: "Harvest",
  });
  await vi.advanceTimersByTimeAsync(50);
  expect(await cancelled).toMatchObject({
    image: null,
    reason: "deadline-exceeded",
    retryable: true,
    requestCount: 0,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(600);
  expect(await first).toMatchObject({ reason: "matched", requestCount: 2 });
  expect(starts[1] - starts[0]).toBe(650);
});

it("uses exturlusage with bounded continuation, rejects prefix collisions and accepts a file without SDC", async () => {
  const fetcher = transport([
    { query: { pages: [] } },
    {
      query: {
        exturlusage: [usage("https://www.geograph.org.uk/photo/577710")],
      },
      continue: { continue: "-||", eucontinue: "next" },
    },
    { query: { exturlusage: [usage()] } },
    { query: { pages: [page()] } },
    { entities: { M101: { id: "M101", missing: "" } } },
  ]);
  const result = await resolveGeographCommonsPhoto(id, {
    fetch: fetcher,
    checkedAt,
  });
  expect(result).toMatchObject({
    reason: "matched",
    requestCount: 5,
    evidence: { lookup: "source-url", structuredIds: [] },
  });
  expect(result.image?.matched).toEqual(["exact-geograph-source-id"]);
  const first = new URL(String(fetcher.mock.calls[1][0]));
  expect(first.searchParams.get("euprotocol")).toBeNull();
  expect(first.searchParams.get("euquery")).toBe(
    "www.geograph.org.uk/photo/57771",
  );
  expect(
    new URL(String(fetcher.mock.calls[2][0])).searchParams.get("eucontinue"),
  ).toBe("next");
});

it("rejects wrong source ID substrings and source host spoofs even when search and SDC match", async () => {
  for (const source of [
    "https://www.geograph.org.uk/photo/577710",
    "https://www.geograph.org.uk.evil.test/photo/57771",
    "https://www.geograph.org.uk/photo/57771/evil",
    "https://www.geograph.org.uk/photo/57771?url=https://evil.test",
  ]) {
    const candidate = page();
    candidate.imageinfo[0].extmetadata.Credit.value = `<a href="${source}">Geograph</a>`;
    const result = await resolveGeographCommonsPhoto(id, {
      fetch: primary(candidate),
      checkedAt,
    });
    expect(result.image).toBeNull();
    expect(["conflicting-source-id", "missing-source-evidence"]).toContain(
      result.reason,
    );
  }
});

it("rejects mismatching or multiple active structured identifiers and requires a real source link", async () => {
  const conflicting = entity("123");
  const multiple = entity();
  multiple.statements.P7384.push(entity("123").statements.P7384[0]);
  for (const sdc of [conflicting, multiple, entity(null)]) {
    const result = await resolveGeographCommonsPhoto(id, {
      fetch: primary(page(), sdc),
      checkedAt,
    });
    expect(result).toMatchObject({
      image: null,
      reason: "conflicting-structured-id",
      retryable: false,
    });
  }
  const noSource = page();
  noSource.imageinfo[0].extmetadata.Credit.value = "Geograph 57771";
  expect(
    await resolveGeographCommonsPhoto(id, {
      fetch: primary(noSource),
      checkedAt,
    }),
  ).toMatchObject({ image: null, reason: "missing-source-evidence" });
});

it("detects conflicting SDC IDs in URL fallback instead of trusting the exact backlink", async () => {
  const fetcher = transport([
    { query: { pages: [] } },
    { query: { exturlusage: [usage()] } },
    { query: { pages: [page()] } },
    { entities: { M101: entity("123") } },
  ]);
  expect(
    await resolveGeographCommonsPhoto(id, { fetch: fetcher, checkedAt }),
  ).toMatchObject({ image: null, reason: "conflicting-structured-id" });
});

it("rejects malformed present structured IDs in fallback and conflicts across claims response shapes", async () => {
  for (const malformed of [
    { id: "M101", statements: { P7384: id } },
    { id: "M101", claims: [] },
    { ...entity(), claims: entity("123").statements },
  ]) {
    const fetcher = transport([
      { query: { pages: [] } },
      { query: { exturlusage: [usage()] } },
      { query: { pages: [page()] } },
      { entities: { M101: malformed } },
    ]);
    expect(
      await resolveGeographCommonsPhoto(id, { fetch: fetcher, checkedAt }),
    ).toMatchObject({ image: null, reason: "conflicting-structured-id" });
  }
});

it("accepts object-keyed pages and claims-shaped MediaInfo without depending on response order", async () => {
  const fetcher = transport([
    { query: { pages: { "101": page() } } },
    { entities: { M101: { id: "M101", claims: entity().statements } } },
  ]);
  expect(
    await resolveGeographCommonsPhoto(id, { fetch: fetcher, checkedAt }),
  ).toMatchObject({ reason: "matched", requestCount: 2 });
});

it("reports duplicate mirrors as ambiguous rather than selecting the first search or URL result", async () => {
  const duplicate = page(102);
  const sdc = { entities: { M101: entity(), M102: entity() } };
  for (const fetcher of [
    transport([{ query: { pages: [page(), duplicate] } }, sdc]),
    transport([
      { query: { pages: [] } },
      { query: { exturlusage: [usage(), usage(undefined, 102)] } },
      { query: { pages: [page(), duplicate] } },
      sdc,
    ]),
  ]) {
    expect(
      await resolveGeographCommonsPhoto(id, { fetch: fetcher, checkedAt }),
    ).toMatchObject({
      image: null,
      reason: "ambiguous-candidates",
      retryable: false,
    });
  }
});

it("rejects missing photographer credit, missing license and licenses with NC or ND restrictions", async () => {
  for (const [credit, license, reason] of [
    ["", "CC BY-SA 2.0", "missing-credit"],
    ["Photographer", "", "non-open-license"],
    ["Photographer", "CC BY-NC 4.0", "non-open-license"],
    ["Photographer", "CC BY-ND 4.0", "non-open-license"],
  ]) {
    const candidate = page();
    candidate.imageinfo[0].extmetadata.Artist.value = credit;
    candidate.imageinfo[0].extmetadata.LicenseShortName.value = license;
    expect(
      await resolveGeographCommonsPhoto(id, {
        fetch: primary(candidate),
        checkedAt,
      }),
    ).toMatchObject({ image: null, reason, retryable: false });
  }
});

it("rejects original, thumbnail and description host spoofs and non-raster images", async () => {
  for (const patch of [
    {
      thumburl:
        "https://upload.wikimedia.org.evil.test/wikipedia/commons/a/ab/test.jpg",
    },
    { url: "https://www.geograph.org.uk/photos/00/57/57771.jpg" },
    {
      url: "https://upload.wikimedia.org@evil.test/wikipedia/commons/a/ab/test.jpg",
    },
    {
      descriptionurl:
        "https://commons.wikimedia.org.evil.test/wiki/File:NS6469_harvest.jpg",
    },
    { descriptionurl: "https://commons.wikimedia.org/wiki/File:Other.jpg" },
    { mime: "image/svg+xml" },
  ]) {
    const candidate = page();
    Object.assign(candidate.imageinfo[0], patch);
    expect(
      await resolveGeographCommonsPhoto(id, {
        fetch: primary(candidate),
        checkedAt,
      }),
    ).toMatchObject({ image: null, reason: "unsafe-image-url" });
  }
});

it("keeps bulk text differences advisory and never pretends to approve venue identity", async () => {
  const result = await resolveGeographCommonsPhoto(id, {
    fetch: primary(),
    checkedAt,
    expectedTitle: "Unrelated museum",
    expectedPhotographer: "Robert Jones",
  });
  expect(result.image).not.toBeNull();
  expect(result.evidence.warnings).toEqual([
    "bulk-title-needs-review",
    "bulk-photographer-needs-review",
  ]);
  expect(result.image?.matched).not.toContain("venue-coordinates");
});

it("validates Geograph IDs and caller cancellation before networking", async () => {
  const fetcher = vi.fn<typeof fetch>();
  for (const invalid of [
    0,
    -1,
    1.1,
    Number.MAX_SAFE_INTEGER + 1,
    "0",
    "1 OR 2",
    "https://www.geograph.org.uk/photo/1",
    "01",
  ]) {
    expect(
      await resolveGeographCommonsPhoto(invalid, { fetch: fetcher }),
    ).toMatchObject({
      reason: "invalid-geograph-id",
      requestCount: 0,
      image: null,
    });
  }
  const controller = new AbortController();
  controller.abort();
  expect(
    await resolveGeographCommonsPhoto(id, {
      fetch: fetcher,
      signal: controller.signal,
    }),
  ).toMatchObject({
    reason: "deadline-exceeded",
    retryable: true,
    requestCount: 0,
  });
  expect(fetcher).not.toHaveBeenCalled();
});

it("bounds and validates JSON response bodies, including chunked oversized bodies", async () => {
  for (const [response, reason] of [
    [
      new Response("<html>Not the API</html>", {
        headers: { "content-type": "text/html" },
      }),
      "invalid-content-type",
    ],
    [
      new Response("{}", {
        headers: {
          "content-type": "application/json",
          "content-length": "9999999",
        },
      }),
      "response-too-large",
    ],
    [
      new Response(" ".repeat(512 * 1024 + 1), {
        headers: { "content-type": "application/json" },
      }),
      "response-too-large",
    ],
    [
      new Response("{ broken", {
        headers: { "content-type": "application/json" },
      }),
      "invalid-json",
    ],
  ] as const) {
    expect(
      await resolveGeographCommonsPhoto(id, { fetch: transport([response]) }),
    ).toMatchObject({ image: null, reason, retryable: false, requestCount: 1 });
  }
});

it("returns retryable rate-limit and maxlag failures without retrying or logging upstream errors", async () => {
  for (const [response, reason] of [
    [
      new Response("slow down", {
        status: 429,
        headers: { "retry-after": "60" },
      }),
      "http-429",
    ],
    [new Response("unavailable", { status: 503 }), "http-503"],
    [
      Response.json({
        error: { code: "maxlag", info: "sensitive upstream text" },
      }),
      "api-maxlag",
    ],
  ] as const) {
    const fetcher = transport([response]);
    const result = await resolveGeographCommonsPhoto(id, { fetch: fetcher });
    expect(result).toMatchObject({
      image: null,
      reason,
      retryable: true,
      requestCount: 1,
    });
    expect(JSON.stringify(result)).not.toContain("sensitive upstream text");
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});

it("enforces a deadline even if a fetch adapter ignores the abort signal", async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(() => new Promise(() => {}));
  const work = resolveGeographCommonsPhoto(id, {
    fetch: fetcher,
    timeoutMs: 50,
  });
  await vi.advanceTimersByTimeAsync(50);
  expect(await work).toMatchObject({
    reason: "deadline-exceeded",
    image: null,
    retryable: true,
    requestCount: 1,
  });
});

it("enforces the same deadline while a JSON response body stalls", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({ cancel }), {
    headers: { "content-type": "application/json" },
  });
  const work = resolveGeographCommonsPhoto(id, {
    fetch: transport([response]),
    timeoutMs: 50,
  });
  await vi.advanceTimersByTimeAsync(50);
  expect(await work).toMatchObject({
    reason: "deadline-exceeded",
    image: null,
    retryable: true,
    requestCount: 1,
  });
  expect(cancel).toHaveBeenCalledTimes(1);
});

it("does not select a candidate from an unfinished continuation", async () => {
  const fetcher = transport([
    { query: { pages: [] } },
    {
      query: { exturlusage: [usage()] },
      continue: { continue: "-||", eucontinue: "next" },
    },
    {
      query: { exturlusage: [] },
      continue: { continue: "-||", eucontinue: "more" },
    },
  ]);
  expect(
    await resolveGeographCommonsPhoto(id, { fetch: fetcher }),
  ).toMatchObject({
    image: null,
    reason: "lookup-incomplete",
    retryable: true,
    requestCount: 3,
  });
});
