import { expect, it } from "vitest";
import {
  parseOfficialPhotoHtml,
  resolveOfficialWebsitePreview,
} from "../src/providers/official-photo";
import { approvedPhoto } from "../src/providers/photo-policy";

const query = {
  name: "Acorn Play",
  website: "https://acorn.co.uk/",
  area: "Fleet",
  lat: 51,
  lng: -1,
};
const html =
  '<title>Acorn Play — our locations</title><h1>Acorn Play</h1><img src="/assets/acorn-logo.svg" alt="Acorn Play logo">';
it("uses a publisher-declared logo without pretending it shows a specific branch", async () => {
  const result = await resolveOfficialWebsitePreview(query, {
    fetch: async () =>
      new Response(html, { headers: { "content-type": "text/html" } }),
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  expect(result.image?.preview?.kind).toBe("brand-logo");
  expect(result.image?.url).toBe("https://acorn.co.uk/assets/acorn-logo.svg");
  expect(approvedPhoto(result.image)).toBeTruthy();
  expect(parseOfficialPhotoHtml(html, query.website, query).candidates).toEqual(
    [],
  );
});
it("refuses a different business logo and sponsorship art", async () => {
  const result = await resolveOfficialWebsitePreview(query, {
    fetch: async () =>
      new Response(
        '<title>Other Play</title><img src="/logo.svg" alt="Other Play logo"><img src="/sponsor-logo.png" alt="Acorn Play sponsor logo">',
        { headers: { "content-type": "text/html" } },
      ),
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  expect(result.image).toBeNull();
});
