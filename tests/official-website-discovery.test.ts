import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});
it("does not use web search without a configured key", async () => {
  vi.stubEnv("TAVILY_API_KEY", "");
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const { searchOfficialWebsite } =
    await import("../src/providers/official-website-discovery");
  expect(
    await searchOfficialWebsite({ name: "Acorn Play", lat: 51, lng: -1 }),
  ).toEqual({ urls: [], status: "disabled" });
  expect(fetcher).not.toHaveBeenCalled();
});
it("returns bounded untrusted official-site candidates, shares lookups and omits directories", async () => {
  vi.stubEnv("TAVILY_API_KEY", "test-private-key");
  const fetcher = vi.fn(async () =>
    Response.json({
      results: [
        { title: "Acorn Play", url: "https://www.facebook.com/acorn" },
        { title: "Acorn Play", url: "https://acorn.example/play" },
        { title: "Acorn Play bookings", url: "https://acorn.example/book" },
        { title: "Acorn Play", url: "https://127.0.0.1/private" },
        { title: "Different venue", url: "https://wrong.example/" },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const { searchOfficialWebsite } =
    await import("../src/providers/official-website-discovery");
  const query = { name: "Acorn Play", lat: 51, lng: -1, area: "Fleet" };
  const [a, b] = await Promise.all([
    searchOfficialWebsite(query),
    searchOfficialWebsite(query),
  ]);
  expect(a).toEqual({ urls: ["https://acorn.example/play"], status: "found" });
  expect(b).toEqual(a);
  expect(await searchOfficialWebsite(query)).toEqual(a);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const options = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  const body = JSON.parse(String(options[1].body));
  expect(body).toMatchObject({
    search_depth: "basic",
    max_results: 5,
    include_images: false,
    auto_parameters: false,
  });
  expect(body.query).toContain("Fleet");
  expect(options[0]).not.toContain("test-private-key");
});
it("treats provider quota exhaustion as unavailable without leaking its response", async () => {
  vi.stubEnv("TAVILY_API_KEY", "test-private-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("private quota detail", { status: 432 })),
  );
  const { searchOfficialWebsite } =
    await import("../src/providers/official-website-discovery");
  expect(
    await searchOfficialWebsite({
      name: "Another play venue",
      lat: 52,
      lng: -2,
    }),
  ).toEqual({ urls: [], status: "unavailable" });
});

it("spends no search credits across public requests even when a Tavily key is configured", async () => {
  vi.stubEnv("TAVILY_API_KEY", "test-private-key");
  const fetcher = vi.fn(async () => Response.json({ results: [] }));
  vi.stubGlobal("fetch", fetcher);
  const { discoverOfficialWebsite } =
    await import("../src/providers/official-website-discovery");
  const results = await Promise.all(
    Array.from({ length: 100 }, (_, i) =>
      discoverOfficialWebsite({
        id: `osm-node-${i + 1}`,
        name: `Public venue ${i}`,
        lat: 51,
        lng: -1,
      }),
    ),
  );
  expect(results.every((result) => result.status === "disabled")).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
});

it("uses free TinyFish search for missing websites and shares cached results", async () => {
  vi.stubEnv("TINYFISH_API_KEY", "free-search-test-key");
  const fetcher = vi.fn(async () =>
    Response.json({
      results: [
        {
          title: "Acorn Play Fleet",
          snippet: "Official venue",
          url: "https://acorn.co.uk/fleet/",
        },
        { title: "Acorn Play", url: "https://www.facebook.com/acorn" },
        { title: "Acorn Play", url: "https://127.0.0.1/" },
        { title: "Other venue", url: "https://other.co.uk/" },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const { discoverOfficialWebsite } =
    await import("../src/providers/official-website-discovery");
  const query = { name: "Acorn Play", area: "Fleet", lat: 51, lng: -1 };
  const results = await Promise.all([
    discoverOfficialWebsite(query),
    discoverOfficialWebsite(query),
  ]);
  expect(results[0]).toEqual({
    urls: ["https://acorn.co.uk/fleet/"],
    status: "found",
  });
  expect(results[1]).toEqual(results[0]);
  await discoverOfficialWebsite(query);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(new URL(url).origin).toBe("https://api.search.tinyfish.ai");
  expect(new URL(url).searchParams.get("location")).toBe("GB");
  expect(url).not.toContain("free-search-test-key");
  expect(init.headers).toMatchObject({ "X-API-Key": "free-search-test-key" });
});

it("backs off free search after a provider limit without invoking paid products", async () => {
  vi.stubEnv("TINYFISH_API_KEY", "free-search-test-key");
  const fetcher = vi.fn(
    async () =>
      new Response("quota detail", {
        status: 429,
        headers: { "Retry-After": "120" },
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const { discoverOfficialWebsite } =
    await import("../src/providers/official-website-discovery");
  for (let i = 0; i < 4; i++)
    expect(
      await discoverOfficialWebsite({ name: `Venue ${i}`, lat: 51, lng: -1 }),
    ).toEqual({ urls: [], status: "unavailable" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
