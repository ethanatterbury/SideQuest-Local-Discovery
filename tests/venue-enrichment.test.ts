import { describe, expect, it } from "vitest";
import { createVenueEnricher } from "@/providers/venue-enrichment";
import { selectVenueEnrichmentCandidates } from "@/providers/venue-enrichment-candidates";
import { PLACES } from "@/providers/places";
import { DEFAULT_QUERY, type Place } from "@/domain/models";
const cafe = (id = "osm-way-420", name = "Acorn & Oak"): Place => ({
  ...PLACES[0],
  id,
  name,
  category: "Café",
  optionalCategory: "food",
  postcode: "GU7 1AA",
  coordinates: { lat: 51.2, lng: -0.6 },
  website: "https://acorn-oak.co.uk/",
  ageRange: undefined,
  familyFeatures: [],
  experiences: undefined,
  evidence: undefined,
  suitability: undefined,
});
const html = `<title>Acorn &amp; Oak</title><address>GU7 1AA</address><p>Our dedicated indoor role play village lets children explore themed shops. Book a play session for your child.</p>`;

describe("bounded venue enrichment", () => {
  it("keeps discovery outages retryable and missing configuration distinct from a verified miss", async () => {
    for (const status of ["unavailable", "disabled"] as const) {
      const enrich = createVenueEnricher({
        getPlace: async () => ({
          ...cafe(),
          website: "https://www.openstreetmap.org/way/420",
        }),
        discoverWebsite: async () => ({ urls: [], status }),
        readWebsite: async () => {
          throw new Error("Must not fetch without a candidate");
        },
      });
      expect(await enrich("osm-way-420")).toEqual({ status, place: null });
    }
  });
  it("discovers official sources when the mapped website is a social or directory profile", async () => {
    for (const website of [
      "https://www.facebook.com/acorn-oak",
      "https://www.instagram.com/acorn-oak/",
      "https://www.tripadvisor.co.uk/acorn-oak",
    ]) {
      const reads: string[] = [];
      const enrich = createVenueEnricher({
        getPlace: async () => ({ ...cafe(), website }),
        discoverWebsite: async () => ({
          urls: ["https://acorn-oak.co.uk/"],
          status: "found",
        }),
        readWebsite: async (url) => {
          reads.push(url);
          return { html, pageUrl: url, requestCount: 1 };
        },
      });
      expect((await enrich("osm-way-420")).status).toBe("verified");
      expect(reads).toEqual(["https://acorn-oak.co.uk/"]);
    }
  });

  it("enriches only the trusted stored identity and caches repeat requests", async () => {
    let reads = 0;
    const enrich = createVenueEnricher({
      getPlace: async (id) => (id === "osm-way-420" ? cafe() : null),
      discoverWebsite: async () => ({ urls: [], status: "disabled" }),
      readWebsite: async (url) => {
        reads++;
        return { html, pageUrl: url, requestCount: 1 };
      },
    });
    const result = await enrich("osm-way-420");
    expect(result.status).toBe("verified");
    expect(result.place).toMatchObject({
      category: "Play café",
      optionalCategory: undefined,
      website: "https://acorn-oak.co.uk/",
    });
    expect(result.place?.experiences?.[0].evidence.source).toBe("official");
    expect(result.place?.ageRange).toBeUndefined();
    expect(await enrich("osm-way-420")).toBe(result);
    expect(reads).toBe(1);
    expect(await enrich("https://attacker.invalid/")).toMatchObject({
      status: "unknown",
      place: null,
    });
  });

  it("follows only bounded same-origin play pages and does not promote an unverified venue", async () => {
    const urls: string[] = [];
    const enrich = createVenueEnricher({
      getPlace: async () => cafe(),
      discoverWebsite: async () => ({ urls: [], status: "disabled" }),
      readWebsite: async (url) => {
        urls.push(url);
        return {
          pageUrl: url,
          requestCount: 1,
          html: url.endsWith("/play")
            ? html
            : `<title>Acorn &amp; Oak</title><address>GU7 1AA</address><a href="https://unrelated.co.uk/play">Play</a><a href="/play">Book play</a>`,
        };
      },
    });
    expect((await enrich("osm-way-420")).status).toBe("verified");
    expect(urls).toEqual([
      "https://acorn-oak.co.uk/",
      "https://acorn-oak.co.uk/play",
    ]);
    const unknown = createVenueEnricher({
      getPlace: async () => cafe(),
      discoverWebsite: async () => ({ urls: [], status: "disabled" }),
      readWebsite: async (url) => ({
        pageUrl: url,
        requestCount: 1,
        html: html.replace("GU7 1AA", "GU9 9ZZ"),
      }),
    });
    expect(await unknown("osm-way-420")).toEqual({
      status: "unknown",
      place: null,
    });
  });

  it("shares in-flight work, caps active metadata requests and bounds stuck providers", async () => {
    let active = 0,
      maximum = 0;
    const enrich = createVenueEnricher({
      timeoutMs: 30,
      getPlace: async (id) => cafe(id),
      discoverWebsite: async () => ({ urls: [], status: "disabled" }),
      readWebsite: async () => {
        active++;
        maximum = Math.max(maximum, active);
        return new Promise(() => {});
      },
    });
    const first = enrich("osm-way-420"),
      second = enrich("osm-way-421"),
      duplicate = enrich("osm-way-420");
    expect(await enrich("osm-way-422")).toEqual({
      status: "unavailable",
      place: null,
    });
    expect(await first).toEqual({ status: "unavailable", place: null });
    expect(await duplicate).toEqual({ status: "unavailable", place: null });
    await second;
    expect(maximum).toBe(2);
  });
});

describe("enrichment candidates", () => {
  it("checks nearest cafés for families while food is disabled and always includes the exact named café", () => {
    const origin = { lat: 51.2, lng: -0.6 };
    const nearby = Array.from({ length: 8 }, (_, i) => ({
      ...cafe(`osm-way-${i + 1}`, `Coffee house ${i + 1}`),
      coordinates: { lat: origin.lat + i * 0.001, lng: origin.lng },
    }));
    const named = {
      ...cafe("osm-way-99", "Target café"),
      coordinates: { lat: 51.3, lng: -0.6 },
    };
    const query = {
      ...DEFAULT_QUERY,
      company: "family" as const,
      includeCategories: [],
      text: "Target cafe",
    };
    const selected = selectVenueEnrichmentCandidates(
      [...nearby, named],
      query,
      origin,
      30,
    );
    expect(selected.map((p) => p.id)).toEqual([
      named.id,
      ...nearby.slice(0, 6).map((p) => p.id),
    ]);
    expect(
      selectVenueEnrichmentCandidates(
        nearby,
        { ...query, company: "solo", text: "" },
        origin,
        30,
      ),
    ).toEqual([]);
    expect(
      selectVenueEnrichmentCandidates(
        [{ ...cafe(), category: "Pub", optionalCategory: "pubs" }],
        query,
        origin,
        30,
      ),
    ).toEqual([]);
  });
});
