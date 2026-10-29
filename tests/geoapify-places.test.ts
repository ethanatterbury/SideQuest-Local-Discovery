import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Geoapify's documented GeoJSON shape. IDs and venue details here are test data.
const feature = (
  raw: Record<string, unknown> = {},
  properties: Record<string, unknown> = {},
) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [-2.24, 53.48] },
  properties: {
    name: "Mapped play cafe",
    lat: 53.48,
    lon: -2.24,
    city: "Manchester",
    categories: ["entertainment", "entertainment.activity_park"],
    place_id: "geoapify-test-place-id",
    datasource: {
      sourcename: "openstreetmap",
      attribution: "© OpenStreetMap contributors",
      license: "Open Database License",
      raw: {
        osm_type: "w",
        osm_id: 987654321,
        amenity: "cafe",
        leisure: "indoor_play",
        ...raw,
      },
    },
    ...properties,
  },
});
const collection = (...features: unknown[]) => ({
  type: "FeatureCollection",
  features,
});

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("GEOAPIFY_API_KEY", "server-only-test-secret");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("configured national discovery", () => {
  it("retains local snapshot venues when every capped provider search succeeds", async () => {
    const { getNearbyPlaces } = await import("@/providers/nearby-places");
    const snapshot = await getNearbyPlaces({ lat: 51.18, lng: -0.62 }, 5);
    expect(snapshot.places.length).toBeGreaterThan(1);
    const overlapping = snapshot.places[0];
    const [, osmType, osmId] = overlapping.id.split("-");
    vi.stubGlobal("fetch", async () =>
      Response.json(
        collection(
          feature(
            {
              osm_id: 987654321,
              leisure: undefined,
              amenity: undefined,
              tourism: "museum",
            },
            { name: "Provider-only museum", lat: 51.18, lon: -0.62 },
          ),
          feature(
            {
              osm_id: Number(osmId),
              osm_type: osmType,
              leisure: undefined,
              amenity: undefined,
              tourism: "museum",
            },
            {
              name: "Updated provider venue",
              lat: overlapping.coordinates.lat,
              lon: overlapping.coordinates.lng,
            },
          ),
        ),
      ),
    );
    const { getDiscoveryPlaces } = await import("@/providers/geoapify-places");
    const result = await getDiscoveryPlaces({ lat: 51.18, lng: -0.62 }, 5);
    expect(result.source).toBe("live");
    expect(result.incomplete).toBeUndefined();
    expect(
      result.places.filter((place) => place.id === overlapping.id),
    ).toMatchObject([{ name: "Updated provider venue" }]);
    expect(
      result.places.some((place) => place.id === snapshot.places[1].id),
    ).toBe(true);
    expect(
      result.places.some((place) => place.id === "osm-way-987654321"),
    ).toBe(true);
  });

  it("does not convert a supplier-marked adult venue into an ordinary cinema", async () => {
    const { normalizeGeoapifyResponse } =
      await import("@/providers/geoapify-places");
    expect(
      normalizeGeoapifyResponse(
        collection(
          feature(
            { leisure: undefined, amenity: "cinema" },
            {
              name: "Fixture cinema",
              categories: ["entertainment.cinema", "adult"],
            },
          ),
        ),
      ),
    ).toEqual([]);
  });

  it("retrieves named culture and activity venues independently when the broad entertainment query stalls", async () => {
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = new URL(input);
      if (url.hostname !== "api.geoapify.com")
        return Response.json({ elements: [] });
      const categories = url.searchParams.get("categories") || "";
      if (categories === "entertainment")
        throw new DOMException("Timed out", "TimeoutError");
      if (url.searchParams.get("conditions") !== "named")
        return Response.json(collection());
      if (categories.includes("entertainment.museum"))
        return Response.json(
          collection(
            feature(
              {
                osm_id: 10001,
                leisure: undefined,
                amenity: undefined,
                tourism: "museum",
              },
              { name: "Fixture museum" },
            ),
          ),
        );
      if (categories.includes("entertainment.bowling_alley"))
        return Response.json(
          collection(
            feature(
              { osm_id: 10002, leisure: "bowling_alley", amenity: undefined },
              { name: "Fixture bowling" },
            ),
          ),
        );
      return Response.json(collection());
    });
    const { getDiscoveryPlaces } = await import("@/providers/geoapify-places");
    const result = await getDiscoveryPlaces(
      { lat: 53.48, lng: -2.24 },
      10,
      false,
    );
    expect(result.source).toBe("live");
    expect(result.incomplete).toBeUndefined();
    expect(result.places.map((place) => place.category)).toEqual(
      expect.arrayContaining(["Museum", "bowling alley"]),
    );
  });

  it("protects museum and indoor-activity capacity from broad land-use results", async () => {
    const urls: URL[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = new URL(input);
      if (url.hostname !== "api.geoapify.com")
        return Response.json({ elements: [] });
      urls.push(url);
      const categories = url.searchParams.get("categories") || "";
      // Production broad-category batches spent their entire result budget on
      // land-use/nature records, leaving museums and indoor venues undiscovered.
      if (
        categories.includes("entertainment") &&
        categories.includes("natural")
      )
        return Response.json(
          collection(
            feature({
              leisure: undefined,
              amenity: undefined,
              landuse: "grass",
            }),
          ),
        );
      if (categories.includes("entertainment"))
        return Response.json(
          collection(
            feature({
              leisure: undefined,
              amenity: undefined,
              tourism: "museum",
            }),
          ),
        );
      return Response.json(collection());
    });
    const { getDiscoveryPlaces } = await import("@/providers/geoapify-places");
    const result = await getDiscoveryPlaces(
      { lat: 53.48, lng: -2.24 },
      10,
      false,
    );
    expect(result.places.map((place) => place.category)).toContain("Museum");
    expect(
      urls.reduce(
        (total, url) => total + Number(url.searchParams.get("limit")),
        0,
      ),
    ).toBeLessThanOrEqual(500);
  });

  it("accepts a successful activity search after the former 2.5 second cutoff", async () => {
    const nativeTimeout = AbortSignal.timeout.bind(AbortSignal);
    // Scale provider time while retaining its relative deadline: a 3-second
    // provider response must survive, without slowing this regression test.
    vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) =>
      nativeTimeout(milliseconds / 100),
    );
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
      if (new URL(input).hostname !== "api.geoapify.com")
        return Response.json({ elements: [] });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 30);
        init?.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(init.signal?.reason);
          },
          { once: true },
        );
      });
      return Response.json(
        collection(
          feature({
            amenity: undefined,
            leisure: undefined,
            tourism: "museum",
          }),
        ),
      );
    });
    const { getDiscoveryPlaces } = await import("@/providers/geoapify-places");
    const result = await getDiscoveryPlaces(
      { lat: 53.48, lng: -2.24 },
      10,
      false,
    );
    expect(result.source).toBe("live");
    expect(result.incomplete).toBeUndefined();
    expect(result.places.map((place) => place.category)).toContain("Museum");
  });

  it("uses separate bounded activity and catering searches and preserves direct detail identity", async () => {
    const urls: URL[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = new URL(input);
      urls.push(url);
      if (url.hostname !== "api.geoapify.com")
        return Response.json({ elements: [] });
      return Response.json(collection(feature()));
    });
    const { GET } = await import("@/app/api/places/route");
    const response = await GET(
      new Request(
        "https://sidequest.test/api/places?lat=53.48&lng=-2.24&radius=10&refresh=1",
      ),
    );
    const body = await response.json();
    expect(body.source).toBe("live");
    expect(body.message).toContain("Geoapify");
    expect(body.places.length).toBeLessThanOrEqual(300);
    expect(
      body.places.find(
        (place: { id: string }) => place.id === "osm-way-987654321",
      ),
    ).toMatchObject({
      id: "osm-way-987654321",
      category: "Indoor soft play",
    });
    expect(JSON.stringify(body)).not.toContain("server-only-test-secret");
    expect(urls).toHaveLength(5);
    expect(urls.every((url) => url.hostname === "api.geoapify.com")).toBe(true);
    const activities = urls.find((url) =>
      url.searchParams.get("categories")?.includes("entertainment"),
    )!;
    const catering = urls.find(
      (url) => url.searchParams.get("categories") === "catering",
    )!;
    expect(
      urls.some((url) => url.searchParams.get("categories") === "commercial"),
    ).toBe(true);
    expect(activities.searchParams.get("categories")).not.toContain("catering");
    for (const url of [activities, catering]) {
      expect(Number(url.searchParams.get("limit"))).toBeGreaterThan(0);
      expect(Number(url.searchParams.get("limit"))).toBeLessThanOrEqual(500);
      expect(url.searchParams.get("filter")).toBe("circle:-2.24,53.48,12000");
      expect(url.searchParams.get("bias")).toBe("proximity:-2.24,53.48");
    }
    const { GET: detail } = await import("@/app/api/places/[id]/route");
    const detailResponse = await detail(
      new Request("https://sidequest.test/api/places/osm-way-987654321"),
      {
        params: Promise.resolve({ id: "osm-way-987654321" }),
      },
    );
    expect((await detailResponse.json()).id).toBe("osm-way-987654321");
    expect(urls).toHaveLength(5);
  });

  it("serves direct links after a cold start through the documented OSM-ID detail lookup", async () => {
    const urls: URL[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = new URL(input);
      urls.push(url);
      return Response.json(
        collection(
          feature(
            { osm_type: "r", osm_id: 7654321 },
            {
              feature_type: "details",
              geometry: undefined,
            },
          ),
        ),
      );
    });
    const { GET } = await import("@/app/api/places/[id]/route");
    const response = await GET(
      new Request("https://sidequest.test/api/places/osm-relation-7654321"),
      {
        params: Promise.resolve({ id: "osm-relation-7654321" }),
      },
    );
    expect(response.status).toBe(200);
    expect((await response.json()).id).toBe("osm-relation-7654321");
    expect(urls).toHaveLength(1);
    expect(urls[0].pathname).toBe("/v2/place-details");
    expect(urls[0].searchParams.get("osm_id")).toBe("7654321");
    expect(urls[0].searchParams.get("osm_type")).toBe("r");
  });

  it("shares and caches nearby requests without refetching on a repeat", async () => {
    const urls: URL[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      urls.push(new URL(input));
      return Response.json(collection(feature()));
    });
    const { getDiscoveryPlaces } = await import("@/providers/geoapify-places");
    const [a, b] = await Promise.all([
      getDiscoveryPlaces({ lat: 53.48, lng: -2.24 }, 10, false),
      getDiscoveryPlaces({ lat: 53.48, lng: -2.24 }, 10, false),
    ]);
    expect(a.places.length).toBeLessThanOrEqual(300);
    expect(a.places.some((place) => place.id === "osm-way-987654321")).toBe(
      true,
    );
    expect(b.places).toEqual(a.places);
    expect(
      (await getDiscoveryPlaces({ lat: 53.48, lng: -2.24 }, 10, false)).source,
    ).toBe("cached");
    expect(urls).toHaveLength(5);
  });

  it.each(["rate limit", "invalid", "empty", "timeout"])(
    "falls back honestly after %s without repeatedly calling Geoapify",
    async (failure) => {
      const urls: URL[] = [];
      if (failure === "timeout") {
        const timeout = AbortSignal.timeout.bind(AbortSignal);
        vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) =>
          milliseconds === 5500
            ? AbortSignal.abort(new DOMException("Timed out", "TimeoutError"))
            : timeout(milliseconds),
        );
      }
      vi.stubGlobal(
        "fetch",
        async (input: string | URL, init?: RequestInit) => {
          const url = new URL(input);
          urls.push(url);
          if (url.hostname === "api.geoapify.com") {
            init?.signal?.throwIfAborted();
            return failure === "rate limit"
              ? new Response("limited", { status: 429 })
              : Response.json(
                  failure === "invalid" ? { features: "broken" } : collection(),
                );
          }
          return Response.json({
            elements: [
              {
                type: "node",
                id: 777123,
                lat: 53.48,
                lon: -2.24,
                tags: { name: "Fallback museum", tourism: "museum" },
              },
            ],
          });
        },
      );
      const { getDiscoveryPlaces } =
        await import("@/providers/geoapify-places");
      const first = await getDiscoveryPlaces(
        { lat: 53.48, lng: -2.24 },
        10,
        false,
      );
      expect(first.places[0].id).toBe("osm-node-777123");
      expect(first.message).toContain("Geoapify");
      expect(first.message).toContain("unavailable");
      const geoRequests = urls.filter(
        (url) => url.hostname === "api.geoapify.com",
      ).length;
      await getDiscoveryPlaces({ lat: 53.48, lng: -2.24 }, 10, false);
      expect(
        urls.filter((url) => url.hostname === "api.geoapify.com"),
      ).toHaveLength(geoRequests);
    },
  );

  it("keeps the existing no-key regional snapshot behavior and rejects non-UK requests without fetching", async () => {
    vi.stubEnv("GEOAPIFY_API_KEY", "");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { getDiscoveryPlaces } = await import("@/providers/geoapify-places");
    const result = await getDiscoveryPlaces({ lat: 51.347, lng: -0.8 }, 18);
    expect(result.source).toBe("cached");
    expect(result.message).toContain("area snapshot");
    expect(result.places).toHaveLength(300);
    vi.stubEnv("GEOAPIFY_API_KEY", "server-only-test-secret");
    expect(
      (await getDiscoveryPlaces({ lat: 41.8, lng: -87.6 }, 10)).places,
    ).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("never labels an empty Geoapify and Overpass response as live coverage", async () => {
    vi.stubGlobal("fetch", async (input: string | URL) =>
      Response.json(
        new URL(input).hostname === "api.geoapify.com"
          ? collection()
          : { elements: [] },
      ),
    );
    const { getDiscoveryPlaces } = await import("@/providers/geoapify-places");
    expect(
      await getDiscoveryPlaces({ lat: 54.7, lng: -2.4 }, 3, false),
    ).toMatchObject({
      places: [],
      source: "fallback",
    });
  });

  it("keeps valid activity results when catering is unavailable and reports partial coverage", async () => {
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = new URL(input);
      return url.searchParams.get("categories") === "catering"
        ? new Response("unavailable", { status: 503 })
        : Response.json(collection(feature()));
    });
    const { getDiscoveryPlaces } = await import("@/providers/geoapify-places");
    const result = await getDiscoveryPlaces(
      { lat: 53.48, lng: -2.24 },
      10,
      false,
    );
    expect(result.places[0].id).toBe("osm-way-987654321");
    expect(result.source).toBe("live");
    expect(result.message).toContain("incomplete");
    expect(
      (await getDiscoveryPlaces({ lat: 53.48, lng: -2.24 }, 10, false)).message,
    ).toContain("incomplete");
    const { GET } = await import("@/app/api/places/route");
    const response = await GET(
      new Request(
        "https://sidequest.test/api/places?lat=53.48&lng=-2.24&radius=10&refresh=1",
      ),
    );
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=60,");
  });

  it.each(["failed", "empty", "food only"])(
    "merges outing fallback with retained catering when the activity batch is %s",
    async (activity) => {
      vi.stubGlobal("fetch", async (input: string | URL) => {
        const url = new URL(input);
        if (url.hostname !== "api.geoapify.com")
          return Response.json({
            elements: [
              {
                type: "node",
                id: 777123,
                lat: 53.48,
                lon: -2.24,
                tags: { name: "Fallback museum", tourism: "museum" },
              },
            ],
          });
        if (url.searchParams.get("categories") === "catering")
          return Response.json(
            collection(feature({ leisure: "", amenity: "cafe" })),
          );
        return activity === "failed"
          ? new Response("unavailable", { status: 503 })
          : Response.json(
              activity === "empty"
                ? collection()
                : collection(feature({ leisure: "", amenity: "cafe" })),
            );
      });
      const { getDiscoveryPlaces } =
        await import("@/providers/geoapify-places");
      const result = await getDiscoveryPlaces(
        { lat: 53.48, lng: -2.24 },
        10,
        false,
      );
      expect(result.places.map((place) => place.id)).toContain(
        "osm-node-777123",
      );
      expect(result.places.map((place) => place.id)).toContain(
        "osm-way-987654321",
      );
      expect(result.incomplete).toBe(true);
      expect(result.message).toContain("incomplete");
      expect(result.message).toContain("Overpass");
      const { GET } = await import("@/app/api/places/route");
      const response = await GET(
        new Request(
          "https://sidequest.test/api/places?lat=53.48&lng=-2.24&radius=10&refresh=1",
        ),
      );
      expect(response.headers.get("Cache-Control")).toContain("s-maxage=60,");
    },
  );

  it("marks a Geoapify failure degraded even when a regional snapshot supplies cached places", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response("unavailable", { status: 503 }),
    );
    const { GET } = await import("@/app/api/places/route");
    const response = await GET(
      new Request(
        "https://sidequest.test/api/places?lat=51.34&lng=-0.8&radius=10",
      ),
    );
    const body = await response.json();
    expect(body.source).toBe("cached");
    expect(body.places.length).toBeGreaterThan(0);
    expect(body.incomplete).toBe(true);
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=60,");
  });
});

describe("Geoapify GeoJSON conversion", () => {
  it("preserves mapped shops as an optional category", async () => {
    const { normalizeGeoapifyResponse } =
      await import("@/providers/geoapify-places");
    expect(
      normalizeGeoapifyResponse(
        collection(feature({ leisure: "", amenity: "", shop: "books" })),
      )[0],
    ).toMatchObject({
      category: "Shop",
      optionalCategory: "shops",
    });
  });
  it("preserves mapped primary play, age restrictions and source media hints without creating licensed photos", async () => {
    const { normalizeGeoapifyResponse } =
      await import("@/providers/geoapify-places");
    const [place] = normalizeGeoapifyResponse(
      collection(
        feature({
          min_age: "1",
          max_age: "6",
          image: "File:Mapped play cafe.jpg",
          wikimedia_commons: "Category:Mapped play cafe",
          wikidata: "Q1234",
          wikipedia: "en:Mapped play cafe",
          website: "https://play.example/",
          access: "customers",
        }),
      ),
    );
    expect(place).toMatchObject({
      id: "osm-way-987654321",
      area: "Manchester",
      category: "Indoor soft play",
      ageRange: [1, 6],
      experiences: [
        {
          activities: ["soft-play"],
          primary: true,
          evidence: { source: "osm", confidence: "reported" },
        },
      ],
      wikidata: "Q1234",
      wikipedia: "en:Mapped play cafe",
      osmImage: "File:Mapped play cafe.jpg",
      commons: "Category:Mapped play cafe",
      source: "https://www.openstreetmap.org/way/987654321",
    });
    expect(place.image).toBeUndefined();
    expect(place.evidence?.infantSuitability).toBeUndefined();
    expect(place.notes.join(" ")).toContain("Geoapify");
    expect(place.notes.join(" ")).toContain("OpenStreetMap contributors");
  });

  it("supports node identity and optional details properties without inferring ages from category or name", async () => {
    const { normalizeGeoapifyResponse } =
      await import("@/providers/geoapify-places");
    const [place] = normalizeGeoapifyResponse(
      collection(
        feature(
          {
            osm_type: "n",
            osm_id: 123,
            leisure: "",
            tourism: "museum",
            amenity: "",
          },
          {
            name: "Baby sensory museum",
            website: "https://museum.example/",
            opening_hours: "Mo-Fr 09:00-17:00",
            wiki_and_media: {
              wikidata: "Q123",
              wikipedia: "en:Museum",
              image: "https://example.org/museum.jpg",
              wikimedia_commons: "Category:Museum",
            },
            categories: ["entertainment.museum", "childcare"],
          },
        ),
      ),
    );
    expect(place.id).toBe("osm-node-123");
    expect(place.category).toBe("Museum");
    expect(place.website).toBe("https://museum.example/");
    expect(place.wikidata).toBe("Q123");
    expect(place.osmImage).toBe("https://example.org/museum.jpg");
    expect(place.hours).toHaveLength(1);
    expect(place.ageRange).toBeUndefined();
    expect(place.suitability?.ageGuidance).toBe("unknown");
    expect(place.evidence?.infantSuitability).toBeUndefined();
    expect(
      normalizeGeoapifyResponse(
        collection(
          feature(
            { leisure: "", amenity: "cafe" },
            {
              name: "Baby soft play cafe",
              categories: ["leisure.playground", "catering.cafe"],
            },
          ),
        ),
      )[0].category,
    ).toBe("Café");
  });

  it("drops restricted, closed, unsupported and invalid records through the OSM eligibility boundary", async () => {
    const { normalizeGeoapifyResponse } =
      await import("@/providers/geoapify-places");
    const rejected = [
      feature({ access: "private" }),
      feature({ access: "no" }),
      feature({ disused: "yes" }),
      feature({ abandoned: "yes" }),
      feature({ demolished: "yes" }),
      feature({ closed: "yes" }),
      feature({ "disused:leisure": "indoor_play" }),
      feature({ leisure: "", amenity: "parking" }),
      feature({ leisure: "", amenity: "", building: "yes" }),
      feature({ osm_type: "area" }),
      feature({ osm_id: "123" }),
      feature({}, { lat: 91 }),
      feature({}, { name: "" }),
      feature({}, { country_code: "fr" }),
      feature({}, { country_code: { code: "gb" } }),
      feature(
        {},
        {
          datasource: {
            sourcename: "other",
            raw: { osm_type: "n", osm_id: 111, leisure: "park" },
          },
        },
      ),
    ];
    expect(normalizeGeoapifyResponse(collection(...rejected))).toEqual([]);
  });

  it("deduplicates overlapping categories and rejects malformed payloads", async () => {
    const { normalizeGeoapifyResponse } =
      await import("@/providers/geoapify-places");
    expect(
      normalizeGeoapifyResponse(collection(feature(), feature())),
    ).toHaveLength(1);
    for (const invalid of [
      null,
      [],
      {},
      { type: "FeatureCollection", features: "broken" },
    ])
      expect(() => normalizeGeoapifyResponse(invalid)).toThrow(
        "Invalid place response",
      );
  });

  it("uses mapped woodland and heath for outdoor outings while leaving individual trees out", async () => {
    const { normalizeGeoapifyResponse } =
      await import("@/providers/geoapify-places");
    const [woodland] = normalizeGeoapifyResponse(
      collection(feature({ leisure: "", amenity: "", natural: "wood" })),
    );
    expect(woodland).toMatchObject({
      category: "Woodland",
      environment: "outdoor",
      intents: ["walk", "scenic", "relax"],
      suitability: { ageGuidance: "unknown" },
    });
    expect(woodland.ageRange).toBeUndefined();
    expect(
      normalizeGeoapifyResponse(
        collection(feature({ leisure: "", amenity: "", natural: "tree" })),
      ),
    ).toEqual([]);
  });
});
