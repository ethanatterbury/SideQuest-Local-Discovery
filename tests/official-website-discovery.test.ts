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
  const { discoverOfficialWebsite } =
    await import("../src/providers/official-website-discovery");
  expect(
    await discoverOfficialWebsite({ name: "Acorn Play", lat: 51, lng: -1 }),
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
  const { discoverOfficialWebsite } =
    await import("../src/providers/official-website-discovery");
  const query = { name: "Acorn Play", lat: 51, lng: -1, area: "Fleet" };
  const [a, b] = await Promise.all([
    discoverOfficialWebsite(query),
    discoverOfficialWebsite(query),
  ]);
  expect(a).toEqual({ urls: ["https://acorn.example/play"], status: "found" });
  expect(b).toEqual(a);
  expect(await discoverOfficialWebsite(query)).toEqual(a);
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
  const { discoverOfficialWebsite } =
    await import("../src/providers/official-website-discovery");
  expect(
    await discoverOfficialWebsite({
      name: "Another play venue",
      lat: 52,
      lng: -2,
    }),
  ).toEqual({ urls: [], status: "unavailable" });
});
