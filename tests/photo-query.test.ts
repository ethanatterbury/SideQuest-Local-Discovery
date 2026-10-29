import { expect, it } from "vitest";
import { PLACES } from "../src/providers/places";
import { placePhotoQuery } from "../src/providers/photo-query";
import { parseOfficialPhotoHtml } from "../src/providers/official-photo";

it("confirms a venue's town when the display area also includes its county", () => {
  const query = placePhotoQuery({
    ...PLACES[0],
    id: "osm-node-123",
    name: "Acorn Play",
    area: "Fleet, Hampshire",
    street: undefined,
    postcode: undefined,
    aliases: [],
    coordinates: { lat: 51.3, lng: -0.8 },
  });
  const result = parseOfficialPhotoHtml(
    '<title>Acorn Play, Fleet</title><h1>Acorn Play</h1><img src="/fleet-play-area.jpg" alt="Our indoor play area in Fleet">',
    "https://acornplay.co.uk/",
    query,
    { websitePreview: true, collectReviewCandidates: true },
  );
  expect(result.identity.matchedName).toBe(true);
  expect(result.identity.matchedArea).toBe(true);
  expect(result.identity.evidence).toContain(
    "venue area in page metadata, path or business address",
  );
});
