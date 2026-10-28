import { describe, expect, it } from "vitest";
import { analyseOfficialVenueEvidence } from "@/providers/official-venue-evidence";
import { normalizeOsmElementWithEvidence } from "@/providers/nearby-places";
import {
  optionalCategory,
  isSuitableForQuery,
} from "@/domain/venue-suitability";
import { isMapFoodPlace } from "@/features/map/map-food";
import { DEFAULT_QUERY } from "@/domain/models";

const venue = {
  id: "osm-way-420",
  name: "Acorn & Oak",
  coordinates: { lat: 51.2, lng: -0.6 },
  postcode: "GU7 1AA",
};
const page = (text: string, extra = "") => ({
  url: "https://acorn-oak.co.uk/",
  html: `<html><head><title>Acorn &amp; Oak</title>${extra}</head><body><h1>Acorn &amp; Oak</h1><address>24 High Street GU7 1AA</address>${text}</body></html>`,
});
const play =
  "Our dedicated indoor role play village lets children explore themed shops and a sensory room. Book a play session for your child.";

describe("official venue evidence", () => {
  it("rejects mixed branch addresses in footers and does not borrow a different same-origin branch's play", () => {
    const mixed = page(
      `${play}<footer>Godalming GU7 1AA | Reading RG1 1AA</footer>`,
    );
    expect(
      analyseOfficialVenueEvidence(venue, [mixed], "2026-10-28"),
    ).toBeNull();
    const home = page("Welcome to our café.");
    const wrongBranch = {
      ...page(play),
      url: "https://acorn-oak.co.uk/reading/play",
    };
    wrongBranch.html = wrongBranch.html.replace(/GU7 1AA/g, "RG1 1AA");
    expect(
      analyseOfficialVenueEvidence(venue, [home, wrongBranch], "2026-10-28"),
    ).toBeNull();
  });

  it("promotes a verified café with substantial booked play to a primary experience without inventing ages", () => {
    const record = analyseOfficialVenueEvidence(
      venue,
      [page(play)],
      "2026-10-28",
    );
    expect(record).toMatchObject({
      id: venue.id,
      name: venue.name,
      classification: "play-cafe",
      source: "official",
      checkedAt: "2026-10-28",
      url: "https://acorn-oak.co.uk/",
      identity: { matchedName: true, matchedLocation: true },
    });
    expect(record).not.toHaveProperty("ageRange");
    expect(record?.quotes.join(" ")).toContain("role play village");
  });

  it("does not classify from the name, family friendliness or a toy corner", () => {
    for (const text of [
      "A family friendly café. Book a table. Children welcome.",
      "Our small soft play corner keeps children busy while you enjoy lunch. Book a table.",
      "Dedicated indoor soft play for children. Book a table.",
    ])
      expect(
        analyseOfficialVenueEvidence(venue, [page(text)], "2026-10-28"),
      ).toBeNull();
  });

  it("requires a location match as well as a name and excludes other branch pages", () => {
    const wrong = page(play);
    wrong.html = wrong.html.replace(/GU7 1AA/g, "GU9 9ZZ");
    expect(
      analyseOfficialVenueEvidence(venue, [wrong], "2026-10-28"),
    ).toBeNull();
    const otherBranch = { ...page(play), url: "https://unrelated.co.uk/play" };
    expect(
      analyseOfficialVenueEvidence(
        venue,
        [page("Café and coffee."), otherBranch],
        "2026-10-28",
      ),
    ).toBeNull();
  });

  it("verifies sparse OSM records using matching named schema geo and a same-origin booking page", () => {
    const sparse = {
      id: venue.id,
      name: venue.name,
      coordinates: venue.coordinates,
    };
    const schema = `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      name: venue.name,
      geo: { "@type": "GeoCoordinates", latitude: 51.2001, longitude: -0.6001 },
    })}</script>`;
    const home = page("Welcome to our café.", schema);
    home.html = home.html.replace(/GU7 1AA/g, "");
    const booking = {
      url: "https://acorn-oak.co.uk/book-play",
      html: `<h1>Play sessions</h1><p>${play}</p>`,
    };
    expect(
      analyseOfficialVenueEvidence(sparse, [home, booking], "2026-10-28")
        ?.classification,
    ).toBe("play-cafe");
    expect(
      analyseOfficialVenueEvidence(
        sparse,
        [{ ...home, html: home.html.replace("51.2001", "52.2001") }, booking],
        "2026-10-28",
      ),
    ).toBeNull();
  });

  it("feeds generated evidence through ordinary OSM normalization and preserves play with food disabled", () => {
    const raw = {
      type: "way",
      id: 420,
      lat: 51.2,
      lon: -0.6,
      tags: { name: venue.name, amenity: "cafe" },
    };
    const evidence = analyseOfficialVenueEvidence(
      venue,
      [page(play)],
      new Date().toISOString(),
    )!;
    const place = normalizeOsmElementWithEvidence(raw, [evidence])!;
    expect(place.category).toBe("Play café");
    expect(optionalCategory(place)).toBeUndefined();
    expect(isMapFoodPlace(place)).toBe(false);
    expect(
      isSuitableForQuery(place, {
        ...DEFAULT_QUERY,
        company: "family",
        childrenAges: [3],
        includeCategories: [],
      }),
    ).toBe(true);
    expect(place.ageRange).toBeUndefined();
    expect(place.evidence?.infantSuitability).toBeUndefined();
    expect(place.experiences?.[0].evidence).toMatchObject({
      source: "official",
      confidence: "verified",
    });
    for (const invalid of [
      { ...evidence, checkedAt: "2099-01-01" },
      { ...evidence, checkedAt: "2020-01-01" },
      { ...evidence, url: "javascript:alert(1)" },
      { ...evidence, name: "A different venue" },
    ])
      expect(normalizeOsmElementWithEvidence(raw, [invalid])?.category).toBe(
        "Café",
      );
  });

  it("does not borrow a different branch's play content from a multi-location page", () => {
    const multi = page(
      play,
      `<script type="application/ld+json">${JSON.stringify([
        {
          "@type": "LocalBusiness",
          name: venue.name,
          geo: { latitude: 51.2, longitude: -0.6 },
        },
        {
          "@type": "LocalBusiness",
          name: venue.name,
          geo: { latitude: 52.2, longitude: -0.6 },
        },
      ])}</script>`,
    );
    expect(
      analyseOfficialVenueEvidence(venue, [multi], "2026-10-28"),
    ).toBeNull();
  });

  it("rejects hidden script claims, negative play claims and invalid dates or source URLs", () => {
    expect(
      analyseOfficialVenueEvidence(
        venue,
        [page(`<script>${play}</script>`)],
        "2026-10-28",
      ),
    ).toBeNull();
    expect(
      analyseOfficialVenueEvidence(
        venue,
        [
          page(
            "We no longer offer indoor soft play for children or bookable play sessions.",
          ),
        ],
        "2026-10-28",
      ),
    ).toBeNull();
    expect(
      analyseOfficialVenueEvidence(venue, [page(play)], "invalid"),
    ).toBeNull();
    expect(
      analyseOfficialVenueEvidence(
        venue,
        [{ ...page(play), url: "http://localhost/" }],
        "2026-10-28",
      ),
    ).toBeNull();
  });
});
