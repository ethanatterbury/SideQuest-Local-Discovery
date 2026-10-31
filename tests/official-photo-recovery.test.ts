import { expect, it, vi } from "vitest";
import {
  resolveOfficialPhotos,
  parseOfficialPhotoHtml,
} from "@/providers/official-photo";

it.each(['property="og:image:url"', 'itemprop="image"'])(
  "reads publisher image metadata variant %s with the same venue checks",
  (attribute) => {
    const result = parseOfficialPhotoHtml(
      `<title>Lantern Play Centre Fleet</title><meta ${attribute} content="https://lantern.co.uk/venue-interior.jpg">`,
      "https://lantern.co.uk/",
      { name: "Lantern Play Centre", area: "Fleet", lat: 51.28, lng: -0.84 },
      { websitePreview: true },
    );
    expect(result.candidates[0]?.url).toBe(
      "https://lantern.co.uk/venue-interior.jpg",
    );
  },
);

it("recovers a vanished official page through the same publisher homepage and rechecks venue identity", async () => {
  const html =
    '<title>Lantern Play Centre, Fleet</title><img src="/interior.jpg" alt="Play area interior" width="1200" height="800">';
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response("Gone", { status: 404 }))
    .mockResolvedValueOnce(
      new Response(html, { headers: { "content-type": "text/html" } }),
    );
  const result = await resolveOfficialPhotos(
    {
      name: "Lantern Play Centre",
      area: "Fleet",
      lat: 51.28,
      lng: -0.84,
      website: "https://lantern.co.uk/old-location/",
    },
    {
      fetch: fetcher,
      lookup: async () => [{ address: "8.8.8.8", family: 4 }],
      websitePreview: true,
    },
  );
  expect(result).toMatchObject({ reason: null });
  expect(result.candidates[0]?.url).toBe("https://lantern.co.uk/interior.jpg");
  expect(result.pageUrl).toBe("https://lantern.co.uk/");
  expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
    "https://lantern.co.uk/old-location/",
    "https://lantern.co.uk/",
  ]);
});

it("does not turn a missing local branch into an unrelated homepage photograph", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response("Gone", { status: 410 }))
    .mockResolvedValueOnce(
      new Response(
        '<title>Other Activity Centre London</title><img src="/interior.jpg" alt="Venue interior">',
        { headers: { "content-type": "text/html" } },
      ),
    );
  const result = await resolveOfficialPhotos(
    {
      name: "Lantern Play Centre",
      area: "Fleet",
      lat: 51.28,
      lng: -0.84,
      website: "https://lantern.co.uk/old-location/",
    },
    {
      fetch: fetcher,
      lookup: async () => [{ address: "8.8.8.8", family: 4 }],
      websitePreview: true,
    },
  );
  expect(result.candidates).toHaveLength(0);
});
