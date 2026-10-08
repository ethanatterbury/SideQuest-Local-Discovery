import { afterEach, expect, it, vi } from "vitest";
import {
  canonicalPlaceName,
  isNearPlace,
  licensedPhoto,
  lookupPlacePhoto,
  matchesPlaceName,
  parsePhotoQuery,
  plainCredit,
  safePhotoUrl,
} from "../src/providers/place-photo";
afterEach(() => vi.unstubAllGlobals());
const query = { name: "Riverside Museum", lat: 55.865, lng: -4.306 };
const info = {
  url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Riverside.jpg",
  thumburl:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Riverside.jpg/1280px-Riverside.jpg",
  descriptionurl: "https://commons.wikimedia.org/wiki/File:Riverside.jpg",
  width: 2000,
  height: 1200,
  mime: "image/jpeg",
  extmetadata: {
    Artist: { value: '<a href="https://example.org">Jane Doe</a>' },
    LicenseShortName: { value: "CC BY-SA 4.0" },
  },
};
it("requires finite coordinates and validates entity hints without accepting URLs", () => {
  for (const value of [
    "name=Park&lat=&lng=1",
    "name=Park&lat=91&lng=1",
    "name=Park&lat=0&lng=Infinity",
    "name=Park&lat=0&lng=0&wikipedia=https://internal",
    "name=Park&lat=0&lng=0&wikidata=http://internal",
  ])
    expect(parsePhotoQuery(new URLSearchParams(value))).toBeNull();
  expect(
    parsePhotoQuery(
      new URLSearchParams(
        "name=Park&lat=0&lng=0&wikipedia=en:Park&wikidata=Q123",
      ),
    ),
  ).toMatchObject({ lat: 0, lng: 0, wikidata: "Q123" });
});
it("rejects a same-name place in a different town and unrelated nearby file", () => {
  expect(isNearPlace(query, 51.5, -0.12)).toBe(false);
  expect(isNearPlace(query, 55.8651, -4.306)).toBe(true);
  expect(matchesPlaceName(query.name, "File:Nearby Cafe 2024.jpg")).toBe(false);
  expect(
    matchesPlaceName(query.name, "File:Riverside Museum Glasgow.jpg"),
  ).toBe(true);
});
it("requires authentic Commons URLs, usable photos, credit and a reusable license", () => {
  expect(licensedPhoto(info)).toMatchObject({
    credit: "Jane Doe",
    license: "CC BY-SA 4.0",
  });
  expect(
    licensedPhoto({
      ...info,
      thumburl: undefined,
      url: "https://upload.wikimedia.org.evil.test/wikipedia/commons/a.jpg",
    }),
  ).toBeNull();
  expect(
    licensedPhoto({
      ...info,
      descriptionurl: "https://example.com/wiki/File:fake",
    }),
  ).toBeNull();
  expect(licensedPhoto({ ...info, width: 300 })).toBeNull();
  expect(
    licensedPhoto({
      ...info,
      extmetadata: {
        Artist: { value: "Jane" },
        LicenseShortName: { value: "CC BY-NC 4.0" },
      },
    }),
  ).toBeNull();
  expect(licensedPhoto({ ...info, mime: "image/svg+xml" })).toBeNull();
  expect(
    licensedPhoto({
      ...info,
      extmetadata: {
        Artist: { value: "Jane" },
        LicenseShortName: { value: "All rights reserved" },
      },
    }),
  ).toBeNull();
  expect(
    safePhotoUrl(
      "https://user:secret@upload.wikimedia.org/wikipedia/commons/a.jpg",
    ),
  ).toBe(false);
  expect(plainCredit("<script>bad()</script><b>Alice &amp; Bob</b>")).toBe(
    "Alice & Bob",
  );
});
it("normalizes Commons tracking parameters for the restricted image optimizer", () => {
  expect(
    licensedPhoto({
      ...info,
      thumburl:
        info.thumburl +
        "?utm_source=commons.wikimedia.org&utm_campaign=imageinfo#photo",
    })?.url,
  ).toBe(info.thumburl);
});
it("does not accept a named Commons photo without matching subject coordinates", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        query: {
          pages: [
            {
              title: "File:Riverside Museum.jpg",
              coordinates: [{ lat: 51.5, lon: -0.1 }],
              imageinfo: [info],
            },
            {
              title: "File:Nearby Cafe.jpg",
              coordinates: [{ lat: query.lat, lon: query.lng }],
              imageinfo: [info],
            },
          ],
        },
      }),
    ),
  );
  expect(await lookupPlacePhoto({ ...query, lat: 55.866 })).toEqual({
    image: null,
    source: "unavailable",
  });
});
it("resolves a matching Commons subject, keeps attribution and reuses cached result", async () => {
  const fetcher = vi.fn(async (requestedUrl: URL) => {
    expect(requestedUrl.hostname).toBe("commons.wikimedia.org");
    return Response.json({
      query: {
        pages: [
          {
            title: "File:Riverside Museum Cached.jpg",
            coordinates: [{ lat: query.lat, lon: query.lng }],
            imageinfo: [info],
          },
        ],
      },
    });
  });
  vi.stubGlobal("fetch", fetcher);
  const place = { ...query, name: "Riverside Museum Cached" };
  expect(await lookupPlacePhoto(place)).toMatchObject({
    source: "live",
    image: { credit: "Jane Doe", source: info.descriptionurl },
  });
  expect(await lookupPlacePhoto(place)).toMatchObject({ source: "cached" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("rejects geographically incorrect Wikidata P18 before requesting its file", async () => {
  const fetcher = vi.fn(async (url: URL) =>
    url.hostname === "www.wikidata.org"
      ? Response.json({
          entities: {
            Q123: {
              labels: { en: { value: "Riverside Museum Entity" } },
              claims: {
                P625: [
                  {
                    mainsnak: {
                      datavalue: {
                        value: {
                          latitude: 51.5,
                          longitude: -0.1,
                          globe: "http://www.wikidata.org/entity/Q2",
                        },
                      },
                    },
                  },
                ],
                P18: [{ mainsnak: { datavalue: { value: "Wrong.jpg" } } }],
              },
            },
          },
        })
      : Response.json({ query: { pages: [] } }),
  );
  vi.stubGlobal("fetch", fetcher);
  expect(
    await lookupPlacePhoto({
      ...query,
      name: "Riverside Museum Entity",
      wikidata: "Q123",
    }),
  ).toMatchObject({ image: null });
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(
    fetcher.mock.calls.some(
      ([url]) => url.searchParams.get("titles") === "File:Wrong.jpg",
    ),
  ).toBe(false);
});

it("matches conservative article/grounds aliases without broadening generic venue names", () => {
  expect(
    matchesPlaceName("The Savill Garden", "File:Savill Garden autumn.jpg"),
  ).toBe(true);
  expect(
    matchesPlaceName(
      "Guildford Castle Grounds",
      "File:Guildford Castle gardens.jpg",
    ),
  ).toBe(true);
  expect(
    matchesPlaceName("Windsor Great Park", "File:Windsor Great aerial.jpg"),
  ).toBe(true);
  expect(canonicalPlaceName("Central Park")).toBe("central park");
  expect(canonicalPlaceName("Botanical Garden Park")).toBe(
    "botanical garden park",
  );
  expect(matchesPlaceName("Central Park", "File:Central Library.jpg")).toBe(
    false,
  );
  expect(
    matchesPlaceName(
      "Guildford Castle Grounds",
      "File:Guildford Cathedral.jpg",
    ),
  ).toBe(false);
  expect(isNearPlace(query, 51.5, -0.12, 600)).toBe(false);
});
it("retains licensed portrait and square photos as crop-aware fallbacks", () => {
  expect(licensedPhoto({ ...info, width: 1200, height: 2000 })).toMatchObject({
    width: 1200,
    height: 2000,
  });
  expect(licensedPhoto({ ...info, width: 1200, height: 1200 })).toMatchObject({
    width: 1200,
    height: 1200,
  });
});
it("searches a canonical name and accepts a named garden subject within 600m", async () => {
  const fetcher = vi.fn(async (requestedUrl: URL) => {
    expect(requestedUrl.hostname).toBe("commons.wikimedia.org");
    return Response.json({
      query: {
        pages: [
          {
            title: "File:Savill Garden Autumn.jpg",
            coordinates: [{ lat: 51.4155, lon: -0.59 }],
            imageinfo: [info],
          },
        ],
      },
    });
  });
  vi.stubGlobal("fetch", fetcher);
  expect(
    await lookupPlacePhoto({
      name: "The Savill Garden",
      lat: 51.411,
      lng: -0.59,
    }),
  ).toMatchObject({ source: "live", image: { credit: "Jane Doe" } });
  const url = fetcher.mock.calls[0]?.[0] as unknown as URL;
  expect(url.searchParams.get("gsrsearch")).toBe('"savill garden"');
  expect(url.searchParams.get("coprimary")).toBe("all");
  expect(url.searchParams.get("colimit")).toBe("max");
});

function mockPipeline(handler: (url: URL) => object) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL) => Response.json(handler(url))),
  );
}
function photoPage(title: string, changes: Record<string, unknown> = {}) {
  return { pageid: 123, title: `File:${title}`, imageinfo: [info], ...changes };
}
it("accepts explicitly declared Commons media without GPS and reports evidence", async () => {
  mockPipeline(() => ({ query: { pages: [photoPage("Entrance.jpg")] } }));
  const result = await lookupPlacePhoto(
    {
      ...query,
      osmImage: "https://commons.wikimedia.org/wiki/File:Entrance.jpg",
    },
    { refresh: true, debug: true },
  );
  expect(result).toMatchObject({
    image: {
      strategy: "osm-image",
      confidence: 0.99,
      width: 2000,
      height: 1200,
      matched: ["declared-file"],
    },
    diagnostics: { strategy: "osm-image", candidateCount: 1 },
  });
});
it("never fetches an arbitrary OSM image host or assumes its license", async () => {
  const fetcher = vi.fn(async (url: URL) => {
    expect(url.hostname).toBe("commons.wikimedia.org");
    return Response.json({ query: { pages: [] } });
  });
  vi.stubGlobal("fetch", fetcher);
  const result = await lookupPlacePhoto(
    { ...query, osmImage: "http://127.0.0.1/private" },
    { refresh: true, debug: true },
  );
  expect(result.image).toBeNull();
  expect(result.diagnostics?.rejected["unlicensed-external-image"]).toBe(1);
});
it("uses validated Wikidata P18 without requiring image GPS", async () => {
  mockPipeline((url) =>
    url.hostname === "www.wikidata.org"
      ? {
          entities: {
            Q777: {
              labels: { en: { value: "Alternate Venue" } },
              aliases: { en: [{ value: query.name }] },
              claims: {
                P625: [
                  {
                    mainsnak: {
                      datavalue: {
                        value: {
                          latitude: query.lat,
                          longitude: query.lng,
                          globe: "http://www.wikidata.org/entity/Q2",
                        },
                      },
                    },
                  },
                ],
                P18: [{ mainsnak: { datavalue: { value: "Entrance.jpg" } } }],
              },
            },
          },
        }
      : { query: { pages: [photoPage("Entrance.jpg")] } },
  );
  expect(
    await lookupPlacePhoto(
      { ...query, wikidata: "Q777" },
      { refresh: true, debug: true },
    ),
  ).toMatchObject({
    image: {
      strategy: "wikidata-p18",
      matched: expect.arrayContaining(["declared-file", "entity-coordinate"]),
    },
  });
});
it("matches aliases plus town context when search images omit GPS", async () => {
  mockPipeline(() => ({
    query: { pages: [photoPage("Transport Museum Glasgow entrance.jpg")] },
  }));
  expect(
    await lookupPlacePhoto(
      { ...query, aliases: ["Transport Museum"], area: "Glasgow" },
      { refresh: true, debug: true },
    ),
  ).toMatchObject({
    image: {
      matched: expect.arrayContaining(["alias", "area"]),
      confidence: expect.any(Number),
    },
  });
});
it("uses Commons category membership and ranks multiple photos by quality", async () => {
  mockPipeline((url) => ({
    query: {
      pages:
        url.searchParams.get("generator") === "categorymembers"
          ? [
              photoPage("Interior portrait.jpg", {
                imageinfo: [
                  {
                    ...info,
                    width: 1300,
                    height: 2100,
                    descriptionurl:
                      "https://commons.wikimedia.org/wiki/File:Interior.jpg",
                  },
                ],
              }),
              photoPage("Exterior landscape.jpg", {
                imageinfo: [
                  {
                    ...info,
                    width: 3200,
                    height: 1800,
                    descriptionurl:
                      "https://commons.wikimedia.org/wiki/File:Exterior.jpg",
                  },
                ],
              }),
            ]
          : [],
    },
  }));
  expect(
    await lookupPlacePhoto(
      { ...query, commons: "Category:Riverside Museum" },
      { refresh: true, debug: true },
    ),
  ).toMatchObject({
    image: {
      source: "https://commons.wikimedia.org/wiki/File:Exterior.jpg",
      strategy: "osm-commons-category",
      width: 3200,
    },
    diagnostics: { candidateCount: 2 },
  });
});
it("accepts a legitimate portrait when it is the available declared photograph", async () => {
  mockPipeline(() => ({
    query: {
      pages: [
        photoPage("Museum portrait.jpg", {
          imageinfo: [{ ...info, width: 1200, height: 2000 }],
        }),
      ],
    },
  }));
  expect(
    await lookupPlacePhoto(
      { ...query, commons: "File:Museum portrait.jpg" },
      { refresh: true },
    ),
  ).toMatchObject({ image: { width: 1200, height: 2000 } });
});
it("uses geo search captions for the actual subject and rejects an unrelated nearby photo", async () => {
  mockPipeline((url) => ({
    query: {
      pages:
        url.searchParams.get("generator") === "geosearch"
          ? [
              photoPage("DSC01234.jpg", {
                coordinates: [{ lat: query.lat, lon: query.lng }],
                imageinfo: [
                  {
                    ...info,
                    extmetadata: {
                      ...info.extmetadata,
                      ImageDescription: {
                        value: "The Riverside Museum, Glasgow, main entrance",
                      },
                    },
                  },
                ],
              }),
              photoPage("Nearby Cafe.jpg", {
                coordinates: [{ lat: query.lat, lon: query.lng }],
              }),
            ]
          : [],
    },
  }));
  const result = await lookupPlacePhoto(
    { ...query, area: "Glasgow" },
    { refresh: true, debug: true },
  );
  expect(result).toMatchObject({
    image: {
      strategy: "commons-geo",
      matched: expect.arrayContaining(["subject-name", "coordinate", "area"]),
    },
    diagnostics: { rejected: { "insufficient-subject-evidence": 1 } },
  });
});
it("rejects a contextual namesake with contradictory geographic evidence", async () => {
  mockPipeline(() => ({
    query: {
      pages: [
        photoPage("Riverside Museum Glasgow.jpg", {
          coordinates: [{ lat: 51.5, lon: -0.1 }],
        }),
      ],
    },
  }));
  const result = await lookupPlacePhoto(
    { ...query, area: "Glasgow" },
    { refresh: true, debug: true },
  );
  expect(result.image).toBeNull();
  expect(result.diagnostics?.rejected["coordinate-conflict"]).toBeGreaterThan(
    0,
  );
});
it("rejects licensed diagrams and surfaces rejection reasons", async () => {
  mockPipeline(() => ({
    query: { pages: [photoPage("Riverside Museum floor plan.png")] },
  }));
  expect(
    await lookupPlacePhoto(
      { ...query, commons: "File:Riverside Museum floor plan.png" },
      { refresh: true, debug: true },
    ),
  ).toMatchObject({
    image: null,
    diagnostics: { rejected: { "non-photographic": expect.any(Number) } },
  });
});
it("refresh bypasses a negative cached lookup", async () => {
  const place = {
    ...query,
    name: "Riverside Refresh",
    commons: "File:Refresh.jpg",
  };
  mockPipeline(() => ({ query: { pages: [] } }));
  expect((await lookupPlacePhoto(place)).image).toBeNull();
  mockPipeline(() => ({ query: { pages: [photoPage("Refresh.jpg")] } }));
  expect((await lookupPlacePhoto(place)).source).toBe("cached");
  expect(
    (await lookupPlacePhoto(place, { refresh: true })).image,
  ).not.toBeNull();
});

it("uses a validated Wikidata Commons category when P18 is missing", async () => {
  mockPipeline((url) =>
    url.hostname === "www.wikidata.org"
      ? {
          entities: {
            Q778: {
              labels: { en: { value: query.name } },
              claims: {
                P373: [
                  {
                    mainsnak: {
                      datavalue: { value: "Riverside Museum Glasgow" },
                    },
                  },
                ],
              },
            },
          },
        }
      : {
          query: {
            pages:
              url.searchParams.get("generator") === "categorymembers"
                ? [photoPage("Museum entrance.jpg")]
                : [],
          },
        },
  );
  expect(
    await lookupPlacePhoto(
      { ...query, wikidata: "Q778" },
      { refresh: true, debug: true },
    ),
  ).toMatchObject({
    image: {
      strategy: "wikidata-p373",
      matched: expect.arrayContaining(["declared-entity", "entity-category"]),
    },
  });
});
it("resolves redirected Wikipedia article imagery without file coordinates", async () => {
  mockPipeline((url) =>
    url.hostname === "en.wikipedia.org"
      ? {
          query: {
            redirects: [{ from: "Transport Museum", to: query.name }],
            pages: [
              {
                title: query.name,
                pageimage: "Entrance.jpg",
                coordinates: [{ lat: query.lat, lon: query.lng }],
              },
            ],
          },
        }
      : { query: { pages: [photoPage("Entrance.jpg")] } },
  );
  expect(
    await lookupPlacePhoto(
      { ...query, wikipedia: "en:Transport Museum" },
      { refresh: true, debug: true },
    ),
  ).toMatchObject({
    image: {
      strategy: "wikipedia-image",
      matched: expect.arrayContaining([
        "article-coordinate",
        "declared-article",
      ]),
    },
  });
});
it("matches structured Commons depicts claims without relying on a camera filename", async () => {
  mockPipeline((url) => {
    if (url.hostname === "www.wikidata.org") return { entities: {} };
    if (url.searchParams.get("action") === "wbgetentities")
      return {
        entities: {
          M123: {
            statements: {
              P180: [{ mainsnak: { datavalue: { value: { id: "Q779" } } } }],
            },
          },
        },
      };
    return {
      query: {
        pages:
          url.searchParams.get("generator") === "geosearch"
            ? [
                photoPage("DSC995.jpg", {
                  coordinates: [{ lat: query.lat, lon: query.lng }],
                }),
              ]
            : [],
      },
    };
  });
  expect(
    await lookupPlacePhoto(
      { ...query, wikidata: "Q779" },
      { refresh: true, debug: true },
    ),
  ).toMatchObject({
    image: {
      strategy: "commons-geo",
      matched: expect.arrayContaining(["depicts-entity", "coordinate"]),
    },
  });
});
it("treats a Wikimedia API error as retryable and preserves other source attempts", async () => {
  mockPipeline(() => ({
    error: { code: "maxlag", info: "Waiting for replicas" },
  }));
  expect(
    await lookupPlacePhoto(
      { ...query, commons: "File:Lag.jpg" },
      { refresh: true, debug: true },
    ),
  ).toMatchObject({
    image: null,
    retryable: true,
    diagnostics: {
      rejected: { "upstream-error": expect.any(Number) },
      sourcesAttempted: expect.arrayContaining([
        "osm-commons-file",
        "commons-search",
        "commons-geo",
      ]),
    },
  });
});
it("recovers photos inside a named category subcategory", async () => {
  mockPipeline((url) => {
    if (url.searchParams.get("gcmtype") === "subcat")
      return {
        query: { pages: [{ title: "Category:Riverside Museum exterior" }] },
      };
    return {
      query: {
        pages:
          url.searchParams.get("gcmtitle") ===
          "Category:Riverside Museum exterior"
            ? [photoPage("Entrance landscape.jpg")]
            : [],
      },
    };
  });
  expect(
    await lookupPlacePhoto(
      { ...query, commons: "Category:Riverside Museum" },
      { refresh: true, debug: true },
    ),
  ).toMatchObject({
    image: {
      strategy: "osm-commons-category",
      matched: expect.arrayContaining(["category-membership"]),
    },
  });
});
it("uses a geographically corroborated named category for files without GPS", async () => {
  mockPipeline((url) => {
    if (url.searchParams.get("generator") === "search")
      return {
        query: {
          pages: [
            photoPage("Museum map.png", {
              coordinates: [{ lat: query.lat, lon: query.lng }],
              categories: [{ title: "Category:Riverside Museum" }],
            }),
          ],
        },
      };
    return {
      query: {
        pages:
          url.searchParams.get("generator") === "categorymembers"
            ? [
                photoPage("DSC entrance.jpg", {
                  categories: [{ title: "Category:Riverside Museum" }],
                }),
              ]
            : [],
      },
    };
  });
  expect(
    await lookupPlacePhoto(query, { refresh: true, debug: true }),
  ).toMatchObject({
    image: {
      strategy: "commons-category",
      matched: expect.arrayContaining([
        "verified-category",
        "category-coordinate",
      ]),
    },
  });
});
it("validates extended query hints and limits alias input", () => {
  expect(
    parsePhotoQuery(
      new URLSearchParams({
        name: query.name,
        lat: String(query.lat),
        lng: String(query.lng),
        area: "Glasgow",
        aliases: '["Transport Museum"]',
        commons: "Category:Riverside Museum",
        id: "osm-123",
      }),
    ),
  ).toMatchObject({
    aliases: ["Transport Museum"],
    area: "Glasgow",
    commons: "Category:Riverside Museum",
    id: "osm-123",
  });
  expect(
    parsePhotoQuery(
      new URLSearchParams({
        name: query.name,
        lat: String(query.lat),
        lng: String(query.lng),
        aliases: "[123]",
      }),
    ),
  ).toBeNull();
});

it("rejects an adjacent business whose caption merely references the sought venue", async () => {
  mockPipeline(() => ({
    query: {
      pages: [
        photoPage("Cafe opposite Riverside Museum Glasgow.jpg", {
          coordinates: [{ lat: query.lat, lon: query.lng }],
          imageinfo: [
            {
              ...info,
              extmetadata: {
                ...info.extmetadata,
                ImageDescription: {
                  value: "A cafe opposite Riverside Museum in Glasgow",
                },
              },
            },
          ],
        }),
      ],
    },
  }));
  expect(
    await lookupPlacePhoto(
      { ...query, area: "Glasgow" },
      { refresh: true, debug: true },
    ),
  ).toMatchObject({
    image: null,
    diagnostics: {
      rejected: { "incidental-place-reference": expect.any(Number) },
    },
  });
});
it("quality ranking prefers a large landscape over the first small matched search result", async () => {
  mockPipeline(() => ({
    query: {
      pages: [
        photoPage("Riverside Museum Glasgow small.jpg", {
          index: 1,
          coordinates: [{ lat: query.lat, lon: query.lng }],
          imageinfo: [
            {
              ...info,
              width: 640,
              height: 480,
              descriptionurl:
                "https://commons.wikimedia.org/wiki/File:Small.jpg",
            },
          ],
        }),
        photoPage("Riverside Museum Glasgow exterior.jpg", {
          index: 2,
          coordinates: [{ lat: query.lat, lon: query.lng }],
          imageinfo: [
            {
              ...info,
              width: 3000,
              height: 1800,
              descriptionurl:
                "https://commons.wikimedia.org/wiki/File:Large.jpg",
            },
          ],
        }),
      ],
    },
  }));
  expect(
    await lookupPlacePhoto({ ...query, area: "Glasgow" }, { refresh: true }),
  ).toMatchObject({
    image: { source: "https://commons.wikimedia.org/wiki/File:Large.jpg" },
  });
});

it("accepts imported media and alias boundary lengths while rejecting oversized fields", () => {
  const params = new URLSearchParams({
    name: query.name,
    lat: String(query.lat),
    lng: String(query.lng),
    osmImage:
      "https://upload.wikimedia.org/wikipedia/commons/a/ab/Riverside.jpg?tracking=".padEnd(
        2048,
        "a",
      ),
    commons: "File:" + "c".repeat(2043),
    website: "https://example.org/".padEnd(2048, "w"),
    aliases: JSON.stringify(["a".repeat(200)]),
  });
  expect(parsePhotoQuery(params)).toMatchObject({
    osmImage: params.get("osmImage"),
    commons: params.get("commons"),
    website: params.get("website"),
    aliases: ["a".repeat(200)],
  });
  for (const field of ["osmImage", "commons", "website"] as const) {
    const oversized = new URLSearchParams(params);
    oversized.set(field, oversized.get(field)! + "x");
    expect(parsePhotoQuery(oversized)).toBeNull();
  }
  const oversizedAlias = new URLSearchParams(params);
  oversizedAlias.set("aliases", JSON.stringify(["a".repeat(201)]));
  expect(parsePhotoQuery(oversizedAlias)).toBeNull();
  const oversizedArea = new URLSearchParams(params);
  oversizedArea.set("area", "x".repeat(501));
  expect(parsePhotoQuery(oversizedArea)).toBeNull();
});
it("extracts a declared Commons file from a normalized long media URL", async () => {
  mockPipeline(() => ({ query: { pages: [photoPage("Riverside.jpg")] } }));
  expect(
    await lookupPlacePhoto(
      {
        ...query,
        osmImage:
          "https://upload.wikimedia.org/wikipedia/commons/a/ab/Riverside.jpg?tracking=".padEnd(
            2048,
            "a",
          ),
      },
      { refresh: true, debug: true },
    ),
  ).toMatchObject({
    image: {
      strategy: "osm-image",
      matched: expect.arrayContaining(["declared-file"]),
    },
  });
});

function qualityEntity(file: string, commonsCategory?: string) {
  return {
    labels: { en: { value: query.name } },
    claims: {
      P625: [
        {
          mainsnak: {
            datavalue: {
              value: {
                latitude: query.lat,
                longitude: query.lng,
                globe: "http://www.wikidata.org/entity/Q2",
              },
            },
          },
        },
      ],
      P18: [{ mainsnak: { datavalue: { value: file } } }],
      ...(commonsCategory
        ? { P373: [{ mainsnak: { datavalue: { value: commonsCategory } } }] }
        : {}),
    },
  };
}
it("keeps a low-resolution P18 fallback while preferring a large P373 landscape", async () => {
  mockPipeline((url) => {
    if (url.hostname === "www.wikidata.org")
      return {
        entities: { Q780: qualityEntity("Small.jpg", "Riverside Museum") },
      };
    const pages =
      url.searchParams.get("titles") === "File:Small.jpg"
        ? [
            photoPage("Small.jpg", {
              imageinfo: [
                {
                  ...info,
                  width: 640,
                  height: 480,
                  descriptionurl:
                    "https://commons.wikimedia.org/wiki/File:Small.jpg",
                },
              ],
            }),
          ]
        : url.searchParams.get("generator") === "categorymembers"
          ? [
              photoPage("Large.jpg", {
                imageinfo: [
                  {
                    ...info,
                    width: 3200,
                    height: 1800,
                    descriptionurl:
                      "https://commons.wikimedia.org/wiki/File:Large.jpg",
                  },
                ],
              }),
            ]
          : [];
    return { query: { pages } };
  });
  expect(
    await lookupPlacePhoto(
      { ...query, wikidata: "Q780" },
      { refresh: true, debug: true },
    ),
  ).toMatchObject({
    image: {
      source: "https://commons.wikimedia.org/wiki/File:Large.jpg",
      strategy: "wikidata-p373",
      width: 3200,
    },
    diagnostics: {
      sourcesAttempted: expect.arrayContaining([
        "wikidata-p18",
        "wikidata-p373",
      ]),
    },
  });
});
it("prefers a verified large search landscape over a declared portrait P18", async () => {
  mockPipeline((url) => {
    if (url.hostname === "www.wikidata.org")
      return { entities: { Q781: qualityEntity("Portrait.jpg") } };
    return {
      query: {
        pages:
          url.searchParams.get("titles") === "File:Portrait.jpg"
            ? [
                photoPage("Portrait.jpg", {
                  imageinfo: [
                    {
                      ...info,
                      width: 1200,
                      height: 2000,
                      descriptionurl:
                        "https://commons.wikimedia.org/wiki/File:Portrait.jpg",
                    },
                  ],
                }),
              ]
            : url.searchParams.get("generator") === "search"
              ? [
                  photoPage("Riverside Museum Glasgow landscape.jpg", {
                    coordinates: [{ lat: query.lat, lon: query.lng }],
                    imageinfo: [
                      {
                        ...info,
                        width: 1500,
                        height: 900,
                        descriptionurl:
                          "https://commons.wikimedia.org/wiki/File:Landscape.jpg",
                      },
                    ],
                  }),
                ]
              : [],
      },
    };
  });
  expect(
    await lookupPlacePhoto(
      { ...query, wikidata: "Q781", area: "Glasgow" },
      { refresh: true, debug: true },
    ),
  ).toMatchObject({
    image: {
      source: "https://commons.wikimedia.org/wiki/File:Landscape.jpg",
      strategy: "commons-search",
      width: 1500,
    },
  });
});
it("preserves a legitimate small declared photo when subsequent Wikimedia sources fail", async () => {
  mockPipeline((url) => {
    if (url.hostname === "www.wikidata.org")
      return {
        entities: { Q782: qualityEntity("Only.jpg", "Riverside Museum") },
      };
    if (url.searchParams.get("titles") === "File:Only.jpg")
      return {
        query: {
          pages: [
            photoPage("Only.jpg", {
              imageinfo: [{ ...info, width: 640, height: 480 }],
            }),
          ],
        },
      };
    return { error: { code: "maxlag" } };
  });
  expect(
    await lookupPlacePhoto(
      { ...query, wikidata: "Q782" },
      { refresh: true, debug: true },
    ),
  ).toMatchObject({
    image: { strategy: "wikidata-p18", width: 640 },
    source: "live",
    diagnostics: {
      sourcesAttempted: expect.arrayContaining([
        "wikidata-p373",
        "commons-search",
      ]),
      rejected: { "upstream-error": expect.any(Number) },
    },
  });
});
it("looks through named category subgalleries when direct members are only portraits", async () => {
  mockPipeline((url) => {
    if (url.searchParams.get("gcmtype") === "subcat")
      return {
        query: { pages: [{ title: "Category:Riverside Museum exterior" }] },
      };
    return {
      query: {
        pages:
          url.searchParams.get("gcmtitle") === "Category:Riverside Museum"
            ? [
                photoPage("Portrait.jpg", {
                  imageinfo: [
                    {
                      ...info,
                      width: 480,
                      height: 640,
                      descriptionurl:
                        "https://commons.wikimedia.org/wiki/File:Portrait.jpg",
                    },
                  ],
                }),
              ]
            : url.searchParams.get("gcmtitle") ===
                "Category:Riverside Museum exterior"
              ? [
                  photoPage("Exterior.jpg", {
                    imageinfo: [
                      {
                        ...info,
                        width: 4800,
                        height: 2700,
                        descriptionurl:
                          "https://commons.wikimedia.org/wiki/File:Exterior.jpg",
                      },
                    ],
                  }),
                ]
              : [],
      },
    };
  });
  expect(
    await lookupPlacePhoto(
      { ...query, commons: "Category:Riverside Museum" },
      { refresh: true, debug: true },
    ),
  ).toMatchObject({
    image: {
      source: "https://commons.wikimedia.org/wiki/File:Exterior.jpg",
      width: 4800,
    },
  });
});

it("queues ten concurrent lookups and deduplicates queued venues without false missing photos", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let inFlight = 0;
  let peakInFlight = 0;
  const fetcher = vi.fn(async () => {
    inFlight++;
    peakInFlight = Math.max(peakInFlight, inFlight);
    try {
      await gate;
      return Response.json({ query: { pages: [photoPage("Queued.jpg")] } });
    } finally {
      inFlight--;
    }
  });
  vi.stubGlobal("fetch", fetcher);
  const places = Array.from({ length: 10 }, (_, index) => ({
    ...query,
    id: `queued-venue-${index}`,
    commons: "File:Queued.jpg",
  }));
  const requests = places.map((place) =>
    lookupPlacePhoto(place, { refresh: true, debug: true }),
  );
  const duplicate = lookupPlacePhoto(places[8], { refresh: true, debug: true });
  await Promise.resolve();
  const admittedBeforeRelease = fetcher.mock.calls.length;
  release();
  const results = await Promise.all([...requests, duplicate]);
  expect(admittedBeforeRelease).toBe(6);
  expect(peakInFlight).toBe(6);
  expect(results.every((result) => !!result.image)).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(10);
});
it("bounds queue overload and permits retry after saturated work completes", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      await gate;
      return Response.json({ query: { pages: [photoPage("Overload.jpg")] } });
    }),
  );
  const places = Array.from({ length: 25 }, (_, index) => ({
    ...query,
    id: `overload-venue-${index}`,
    commons: "File:Overload.jpg",
  }));
  const requests = places.map((place) =>
    lookupPlacePhoto(place, { refresh: true, debug: true }),
  );
  const overflow = await requests[24];
  release();
  const results = await Promise.all(requests);
  expect(overflow).toMatchObject({
    image: null,
    retryable: true,
    diagnostics: { rejected: { "concurrency-limit": 1 } },
  });
  expect(results.filter((result) => !!result.image)).toHaveLength(24);
  expect(await lookupPlacePhoto(places[24], { debug: true })).toMatchObject({
    source: "live",
    image: { strategy: "osm-commons-file" },
  });
});
it("expires bounded queue waits without caching misses or leaking admission slots", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await gate;
        return Response.json({ query: { pages: [photoPage("Timeout.jpg")] } });
      }),
    );
    const activeRequests = Array.from({ length: 6 }, (_, index) =>
      lookupPlacePhoto(
        {
          ...query,
          id: `timeout-active-${index}`,
          commons: "File:Timeout.jpg",
        },
        { refresh: true },
      ),
    );
    const waitingPlace = {
      ...query,
      id: "timeout-queued",
      commons: "File:Timeout.jpg",
    };
    const waiting = lookupPlacePhoto(waitingPlace, {
      refresh: true,
      debug: true,
    });
    await vi.advanceTimersByTimeAsync(8000);
    const expired = await waiting;
    release();
    await Promise.all(activeRequests);
    expect(expired).toMatchObject({
      image: null,
      retryable: true,
      diagnostics: { rejected: { "queue-timeout": 1 }, elapsedMs: 8000 },
    });
    expect(await lookupPlacePhoto(waitingPlace)).toMatchObject({
      source: "live",
      image: { strategy: "osm-commons-file" },
    });
  } finally {
    release();
    vi.useRealTimers();
  }
});

it("releases six hung upstream leases at ten seconds and admits a later queued lookup", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const call = ++calls;
        if (call <= 6) await gate;
        return Response.json({ query: { pages: [photoPage("Lease.jpg")] } });
      }),
    );
    const completed: Awaited<ReturnType<typeof lookupPlacePhoto>>[] = [];
    const held = Array.from({ length: 6 }, (_, index) =>
      lookupPlacePhoto(
        { ...query, id: `lease-held-${index}`, commons: "File:Lease.jpg" },
        { refresh: true, debug: true },
      ).then((result) => {
        completed.push(result);
        return result;
      }),
    );
    await vi.advanceTimersByTimeAsync(3000);
    let queuedResult: Awaited<ReturnType<typeof lookupPlacePhoto>> | undefined;
    const queued = lookupPlacePhoto(
      { ...query, id: "lease-later", commons: "File:Lease.jpg" },
      { refresh: true, debug: true },
    ).then((result) => {
      queuedResult = result;
      return result;
    });
    await vi.advanceTimersByTimeAsync(7000);
    const expiredBeforeFetchReleased = [...completed];
    const queuedBeforeFetchReleased = queuedResult;
    release();
    await Promise.all([...held, queued]);
    expect(expiredBeforeFetchReleased).toHaveLength(6);
    expect(
      expiredBeforeFetchReleased.every(
        (result) => result.retryable && !result.image,
      ),
    ).toBe(true);
    expect(queuedBeforeFetchReleased).toMatchObject({
      image: { strategy: "osm-commons-file" },
      diagnostics: { queuedMs: 7000 },
    });
    expect(calls).toBe(7);
  } finally {
    release();
    vi.useRealTimers();
  }
});
it("preserves a verified small fallback when a later provider ignores its abort signal", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        if (url.hostname === "www.wikidata.org")
          return Response.json({
            entities: {
              Q783: qualityEntity("Fallback.jpg", "Riverside Museum"),
            },
          });
        if (url.searchParams.get("titles") === "File:Fallback.jpg")
          return Response.json({
            query: {
              pages: [
                photoPage("Fallback.jpg", {
                  imageinfo: [{ ...info, width: 640, height: 480 }],
                }),
              ],
            },
          });
        await gate;
        return Response.json({ query: { pages: [] } });
      }),
    );
    let resolved: Awaited<ReturnType<typeof lookupPlacePhoto>> | undefined;
    const lookup = lookupPlacePhoto(
      { ...query, wikidata: "Q783" },
      { refresh: true, debug: true },
    ).then((result) => {
      resolved = result;
      return result;
    });
    await vi.advanceTimersByTimeAsync(10000);
    const resultBeforeProviderReleased = resolved;
    release();
    await lookup;
    expect(resultBeforeProviderReleased).toMatchObject({
      image: { width: 640, strategy: "wikidata-p18" },
      diagnostics: { elapsedMs: 10000 },
    });
  } finally {
    release();
    vi.useRealTimers();
  }
});
