import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});
const query = {
  name: "Acorn & Bee",
  aliases: ["The Playroom"],
  lat: 51,
  lng: -1,
  wikidata: "Q123456",
};
function entity(extra: Record<string, unknown> = {}) {
  return {
    id: "Q123456",
    labels: { en: { value: "Acorn and Bee" } },
    claims: {
      P856: [
        {
          rank: "normal",
          mainsnak: {
            snaktype: "value",
            datatype: "url",
            datavalue: { value: "https://acorn.co.uk/visit" },
          },
        },
      ],
      P625: [
        {
          rank: "normal",
          mainsnak: {
            snaktype: "value",
            datatype: "globe-coordinate",
            datavalue: {
              value: {
                latitude: 51.001,
                longitude: -1,
                globe: "http://www.wikidata.org/entity/Q2",
              },
            },
          },
        },
      ],
    },
    ...extra,
  };
}
async function lookup(
  data = entity(),
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
) {
  vi.stubEnv("TINYFISH_API_KEY", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ entities: { Q123456: data } })),
  );
  const { discoverOfficialWebsite } =
    await import("../src/providers/official-website-discovery");
  return discoverOfficialWebsite(query, options);
}

describe("mapped official website resolution", () => {
  it("resolves a matching nearby explicit Wikidata entity without keys or guessed domains", async () => {
    expect(await lookup()).toEqual({
      urls: ["https://acorn.co.uk/visit"],
      status: "found",
    });
    const fetcher = vi.mocked(fetch);
    const [url, options] = fetcher.mock.calls[0];
    const request = new URL(String(url));
    expect(request.origin + request.pathname).toBe(
      "https://www.wikidata.org/w/api.php",
    );
    expect(request.searchParams.get("ids")).toBe("Q123456");
    expect(request.searchParams.get("props")).toBe("labels|aliases|claims");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(options?.headers).toHaveProperty("User-Agent");
  });
  it("accepts token-equivalent aliases without substring matching", async () => {
    expect(
      await lookup(
        entity({
          labels: { en: { value: "Different name" } },
          aliases: { en: [{ value: "Playroom, The" }] },
        }),
      ),
    ).toHaveProperty("status", "found");
  });
  it.each([
    ["different entity", entity({ id: "Q999" })],
    [
      "wrong name",
      entity({ labels: { en: { value: "Acorn and Bee Other Branch" } } }),
    ],
    ["missing coordinates", entity({ claims: { P856: entity().claims.P856 } })],
    [
      "far coordinates",
      entity({
        claims: {
          ...entity().claims,
          P625: [
            {
              rank: "normal",
              mainsnak: {
                snaktype: "value",
                datavalue: {
                  value: {
                    latitude: 52,
                    longitude: -1,
                    globe: "http://www.wikidata.org/entity/Q2",
                  },
                },
              },
            },
          ],
        },
      }),
    ],
    [
      "private URL",
      entity({
        claims: {
          ...entity().claims,
          P856: [
            {
              rank: "normal",
              mainsnak: {
                snaktype: "value",
                datavalue: { value: "https://127.0.0.1/private" },
              },
            },
          ],
        },
      }),
    ],
    [
      "deprecated website",
      entity({
        claims: {
          ...entity().claims,
          P856: [{ ...entity().claims.P856[0], rank: "deprecated" }],
        },
      }),
    ],
    [
      "deprecated coordinates",
      entity({
        claims: {
          ...entity().claims,
          P625: [{ ...entity().claims.P625[0], rank: "deprecated" }],
        },
      }),
    ],
  ])("rejects %s without automatically verifying a site", async (_, data) => {
    expect(await lookup(data)).toEqual({ urls: [], status: "no-match" });
  });
  it("shares equivalent requests and retains only cached site metadata", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "");
    const fetcher = vi.fn(async () =>
      Response.json({ entities: { Q123456: entity() } }),
    );
    vi.stubGlobal("fetch", fetcher);
    const { discoverOfficialWebsite } =
      await import("../src/providers/official-website-discovery");
    const results = await Promise.all([
      discoverOfficialWebsite(query),
      discoverOfficialWebsite(query),
    ]);
    expect(results[0].urls).toEqual(["https://acorn.co.uk/visit"]);
    expect(results[1]).toEqual(results[0]);
    expect(await discoverOfficialWebsite(query)).toEqual(results[0]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not request Wikidata for a missing or malformed identifier", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { discoverOfficialWebsite } =
      await import("../src/providers/official-website-discovery");
    for (const wikidata of [
      undefined,
      "Q0",
      "q123",
      "https://wikidata.org/Q123",
      "Q123|Q456",
    ])
      expect(await discoverOfficialWebsite({ ...query, wikidata })).toEqual({
        urls: [],
        status: "disabled",
      });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("honours caller cancellation even when a transport does not settle", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "");
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_: unknown, init?: RequestInit) => {
        requestSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      }),
    );
    const { discoverOfficialWebsite } =
      await import("../src/providers/official-website-discovery");
    const controller = new AbortController();
    const pending = discoverOfficialWebsite(query, {
      signal: controller.signal,
    });
    controller.abort();
    expect(await pending).toEqual({ urls: [], status: "unavailable" });
    expect(requestSignal?.aborted).toBe(true);
  });
  it("bounds a hanging request to the caller's remaining time", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const { discoverOfficialWebsite } =
      await import("../src/providers/official-website-discovery");
    expect(await discoverOfficialWebsite(query, { timeoutMs: 10 })).toEqual({
      urls: [],
      status: "unavailable",
    });
  }, 1000);
  it("rejects a response larger than 512 KiB", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(" ".repeat(524289))),
    );
    const { discoverOfficialWebsite } =
      await import("../src/providers/official-website-discovery");
    expect(await discoverOfficialWebsite(query)).toEqual({
      urls: [],
      status: "unavailable",
    });
  });
  it("rechecks exact coordinates across the 250 metre boundary instead of reusing rounded metadata", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "");
    const data = entity({
      claims: {
        ...entity().claims,
        P625: [
          {
            rank: "normal",
            mainsnak: {
              snaktype: "value",
              datavalue: {
                value: {
                  latitude: 51.00224,
                  longitude: -1,
                  globe: "http://www.wikidata.org/entity/Q2",
                },
              },
            },
          },
        ],
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ entities: { Q123456: data } })),
    );
    const { discoverOfficialWebsite } =
      await import("../src/providers/official-website-discovery");
    expect(await discoverOfficialWebsite(query)).toHaveProperty(
      "status",
      "found",
    );
    expect(await discoverOfficialWebsite({ ...query, lat: 50.99998 })).toEqual({
      urls: [],
      status: "no-match",
    });
  });
  it("lets another consumer finish when a shared lookup's first consumer cancels", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "");
    let release!: (response: Response) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const { discoverOfficialWebsite } =
      await import("../src/providers/official-website-discovery");
    const controller = new AbortController();
    const cancelled = discoverOfficialWebsite(query, {
      signal: controller.signal,
    });
    const retained = discoverOfficialWebsite(query);
    controller.abort();
    expect(await cancelled).toEqual({ urls: [], status: "unavailable" });
    release(Response.json({ entities: { Q123456: entity() } }));
    expect(await retained).toEqual({
      urls: ["https://acorn.co.uk/visit"],
      status: "found",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("bounds a response body that stops sending bytes", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("{"));
              },
            }),
          ),
      ),
    );
    const { discoverOfficialWebsite } =
      await import("../src/providers/official-website-discovery");
    expect(await discoverOfficialWebsite(query, { timeoutMs: 10 })).toEqual({
      urls: [],
      status: "unavailable",
    });
  }, 1000);
});
