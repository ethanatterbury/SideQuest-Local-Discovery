import { describe, expect, it } from "vitest";
import {
  assessMapPhotoEvidence,
  canonicalMapPlace,
  getMapPhotoCandidates,
  normalizeMapPhotoUrl,
} from "../src/providers/map-photo-evidence";
import type { MapPhotoRecord } from "../src/providers/map-photo-evidence";

const query = {
  id: "venue",
  name: "Thorpe Lakes Watersports Resort",
  lat: 51.405,
  lng: -0.513,
  category: "Water sports",
};
const photo =
  "https://lh3.googleusercontent.com/p/AF1QipM_actualContributorPhotoToken=w408-h240-k-no";
const source = (lat = query.lat, lng = query.lng) =>
  `https://www.google.com/maps/place/Thorpe+Lakes/@${lat},${lng},17z/data=!3m1!4b1!8m2!3d${lat}!4d${lng}!16sabc?entry=ttu`;
const record = (changes: Partial<MapPhotoRecord> = {}): MapPhotoRecord => ({
  id: query.id,
  name: query.name,
  lat: query.lat,
  lng: query.lng,
  title: "Thorpe Lakes UK",
  url: source(),
  images: [photo],
  ...changes,
});

describe("public Maps place photo evidence", () => {
  it("preserves the contributor's photo identity and source attribution", () => {
    expect(getMapPhotoCandidates(query, record())[0]).toMatchObject({
      url: photo.replace("=w408-h240-k-no", "=w1400-h1000-k-no"),
      originalUrl: photo,
      credit: "Google Maps contributors",
      license: "Google Maps contributors — rights reserved",
      source: source().split("?")[0],
    });
  });
  it("accepts title variations without borrowing a similarly named adjacent venue", () => {
    expect(getMapPhotoCandidates(query, record())).toHaveLength(1);
    expect(
      assessMapPhotoEvidence(query, record({ title: "Thorpe Park" })).rejected,
    ).toHaveProperty("venue-name-mismatch");
    for (const [name, title] of [
      ["Playbarn & MiniFarm", "Jake's Playbarn"],
      ["Jump In", "Jump In by AirHop Adventure & Trampoline Park"],
      ["Fenixia Chinese Restaurant", "Fenixia Restaurant"],
      ["Pinewood Gymnastics Club Ltd", "Pinewood Gymnastics Club"],
      ["Moor Green Lakes Nature Reserve", "Moor Green Lakes"],
      ["Heathlake Nature Reserve", "Heath Lake"],
      ["Curly Bridge Close play area", "Curly Bridge Close Playground"],
      [
        "London Road Recreation Ground Playground",
        "London Road Recreation Ground",
      ],
      [
        "Wellington College Health and Fitness Club",
        "Wellington Health and Fitness Club",
      ],
    ])
      expect(
        getMapPhotoCandidates({ ...query, name }, record({ name, title })),
        name,
      ).toHaveLength(1);
  });
  it("requires canonical branch coordinates, never search or camera coordinates", () => {
    for (const url of [
      "https://www.google.com/maps/search/Thorpe+Lakes",
      "https://www.google.com/maps/place/Thorpe+Lakes/@51.405,-0.513,17z/",
    ])
      expect(
        assessMapPhotoEvidence(query, record({ url })).rejected,
      ).toHaveProperty("canonical-place-location-required");
    expect(
      getMapPhotoCandidates(query, record({ url: source(51.42) })),
    ).toEqual([]);
    expect(canonicalMapPlace(source(51.405, -0.513))).toMatchObject({
      lat: 51.405,
      lng: -0.513,
    });
  });
  it("rejects record and branch mismatches, even for matching chain names", () => {
    for (const change of [{ id: "other" }, { name: "Another" }, { lat: 51.5 }])
      expect(
        assessMapPhotoEvidence(query, record(change)).rejected,
      ).toHaveProperty("record-place-mismatch");
    expect(
      getMapPhotoCandidates(query, record({ url: source(51.409) })),
    ).toEqual([]);
  });
  it("keeps generic venue names tightly located and allows named park extents", () => {
    const generic = { ...query, name: "Playground", category: "Playground" };
    expect(
      getMapPhotoCandidates(
        generic,
        record({
          name: generic.name,
          title: generic.name,
          url: source(51.406),
        }),
      ),
    ).toEqual([]);
    const park = {
      ...query,
      name: "Dinton Pastures Park",
      category: "Nature park",
    };
    expect(
      getMapPhotoCandidates(
        park,
        record({ name: park.name, title: park.name, url: source(51.411) }),
      ),
    ).toHaveLength(1);
    expect(
      getMapPhotoCandidates(
        park,
        record({ name: park.name, title: park.name, url: source(51.42) }),
      ),
    ).toEqual([]);
  });
  it("rejects avatars, branding, untrusted hosts and unsafe URL forms", () => {
    for (const url of [
      "https://lh3.googleusercontent.com/a-/avatarToken=s100",
      "https://lh3.googleusercontent.com/ogw/avatarToken=s100",
      "https://lh3.googleusercontent.com/logo.png",
      photo.replace("https:", "http:"),
      photo.replace(
        "lh3.googleusercontent.com",
        "lh3.googleusercontent.com.evil.com",
      ),
      photo.replace("https://", "https://user:pass@"),
      `${photo}?other=photo`,
    ])
      expect(normalizeMapPhotoUrl(url), url).toBeNull();
    expect(
      canonicalMapPlace(source().replace("www.google.com", "evil.com")),
    ).toBeNull();
  });
  it("accepts known contributor CDN paths and deduplicates delivery sizes", () => {
    for (const path of ["p", "gps-cs-s", "grass-cs"])
      expect(normalizeMapPhotoUrl(photo.replace("/p/", `/${path}/`))).toContain(
        `/${path}/AF1QipM_actualContributorPhotoToken=w1400-h1000-k-no`,
      );
    expect(
      getMapPhotoCandidates(
        query,
        record({ images: [photo, photo.replace("w408", "w800")] }),
      ),
    ).toHaveLength(1);
  });
  it("rejects malformed records and explicitly labeled graphic content", () => {
    expect(
      assessMapPhotoEvidence(query, record({ images: undefined as never }))
        .rejected,
    ).toHaveProperty("invalid-record");
    expect(
      assessMapPhotoEvidence(
        query,
        record({ images: [{ url: photo, alt: "Restaurant menu poster" }] }),
      ).rejected,
    ).toHaveProperty("non-venue-photo");
  });
  it("uses Street View only with explicit evidence of the actual place photo header", () => {
    const panorama =
      "https://streetviewpixels-pa.googleapis.com/v1/thumbnail?panoid=actualPanoramaToken&cb_client=maps_sv.tactile&w=408&h=240&yaw=30";
    expect(
      getMapPhotoCandidates(query, record({ images: [panorama] })),
    ).toEqual([]);
    expect(
      getMapPhotoCandidates(
        query,
        record({ images: [{ url: panorama, placeHeader: true }] }),
      )[0],
    ).toMatchObject({
      originalUrl: panorama,
      credit: "Google Maps Street View",
      license: "Google Street View — rights reserved",
    });
  });
});
