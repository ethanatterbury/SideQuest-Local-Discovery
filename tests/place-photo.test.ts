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
it("requires authentic Commons URLs, landscape photos, credit and a reusable license", () => {
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
  expect(fetcher).toHaveBeenCalledTimes(2);
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
it("rejects portrait and square assets even when Wikimedia licensing is valid", () => {
  expect(licensedPhoto({ ...info, width: 1200, height: 2000 })).toBeNull();
  expect(licensedPhoto({ ...info, width: 1200, height: 1200 })).toBeNull();
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
