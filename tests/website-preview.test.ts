import { expect, it, vi } from "vitest";
import * as official from "../src/providers/official-photo";
import { approvedPhoto, openPhotoLicense } from "../src/providers/photo-policy";

const query = {
  name: "Little Lantern Play",
  area: "Fleet",
  category: "soft-play",
  lat: 51.28,
  lng: -0.84,
  website: "https://littlelantern.co.uk/fleet/",
};
const html = `<title>Little Lantern Play, Fleet</title><meta property="og:image" content="/fleet-interior.jpg"><meta property="og:image:alt" content="Little Lantern Play Fleet interior"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><img src="/gallery.jpg" alt="Play area interior">`;
const lookup = async () => [{ address: "8.8.8.8", family: 4 }];

it("returns a local venue's published preview with reserved rights and source evidence", async () => {
  const result = await official.resolveOfficialWebsitePreview(query, {
    fetch: vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(html, { headers: { "content-type": "text/html" } }),
      ),
    lookup,
  });
  expect(result.image).toMatchObject({
    url: "https://littlelantern.co.uk/fleet-interior.jpg",
    rights: "website-preview",
    strategy: "official-website-preview",
    source: query.website,
    preview: {
      kind: "open-graph",
      pageUrl: query.website,
      publisher: query.name,
    },
  });
  expect(openPhotoLicense(result.image!.license)).toBe(false);
  expect(approvedPhoto(result.image)?.rights).toBe("website-preview");
});

it("never promotes gallery assets into published link previews", () => {
  const result = official.parseOfficialPhotoHtml(
    html.replace(/<meta[^>]*>/g, ""),
    query.website,
    query,
    { socialPreviewOnly: true },
  );
  expect(result.candidates).toEqual([]);
});

it.each([
  ["logo", html.replaceAll("fleet-interior.jpg", "logo.jpg")],
  [
    "food",
    html
      .replaceAll("fleet-interior.jpg", "pizza.jpg")
      .replace("Little Lantern Play Fleet interior", "pizza and burgers"),
  ],
  [
    "stock",
    html.replace(
      "/fleet-interior.jpg",
      "https://images.unsplash.com/interior.jpg",
    ),
  ],
  ["wrong branch", html.replaceAll("Fleet", "Reading")],
])("rejects a %s preview", async (_label, page) => {
  const result = await official.resolveOfficialWebsitePreview(query, {
    fetch: vi.fn<typeof fetch>().mockResolvedValue(
      new Response(page.replace(/<img[^>]*>/g, ""), {
        headers: { "content-type": "text/html" },
      }),
    ),
    lookup,
  });
  expect(result.image).toBeNull();
});

it("does not accept a reserved image carrying only a preview label", () => {
  expect(
    approvedPhoto({
      url: "https://littlelantern.co.uk/interior.jpg",
      source: query.website,
      credit: query.name,
      license: "Website preview — rights reserved",
      rights: "website-preview",
      strategy: "official-website-preview",
      checkedAt: "2026-10-28T00:00:00Z",
    }),
  ).toBeUndefined();
});

it("uses the matching on-page image caption when a published preview has no alt", async () => {
  const page =
    html
      .replace(
        '<meta property="og:image:alt" content="Little Lantern Play Fleet interior">',
        "",
      )
      .replaceAll("fleet-interior.jpg", "a18392.jpg") +
    '<img src="/a18392.jpg" alt="Little Lantern Play soft play area interior">';
  const result = await official.resolveOfficialWebsitePreview(query, {
    fetch: vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(page, { headers: { "content-type": "text/html" } }),
      ),
    lookup,
  });
  expect(result.image?.url).toBe("https://littlelantern.co.uk/a18392.jpg");
});

it("does not use an unrelated page image caption to approve an unknown preview", async () => {
  const page = html
    .replace(
      '<meta property="og:image:alt" content="Little Lantern Play Fleet interior">',
      "",
    )
    .replaceAll("fleet-interior.jpg", "a18392.jpg");
  const result = await official.resolveOfficialWebsitePreview(query, {
    fetch: vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(page, { headers: { "content-type": "text/html" } }),
      ),
    lookup,
  });
  expect(result.image?.url).toBe("https://littlelantern.co.uk/gallery.jpg");
  expect(result.image?.preview?.kind).toBe("venue-image");
});

it("does not accept another branch just because the footer lists the requested town", async () => {
  const page =
    html.replaceAll("Fleet", "Reading") +
    "<footer>Our locations: Fleet, Reading, London</footer>";
  const result = await official.resolveOfficialWebsitePreview(query, {
    fetch: vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(page, { headers: { "content-type": "text/html" } }),
      ),
    lookup,
  });
  expect(result.image).toBeNull();
});

it("does not identify a branch from a postcode in a chain footer", async () => {
  const page =
    html
      .replaceAll("Fleet", "Reading")
      .replaceAll("fleet-interior", "reading-interior") +
    "<footer>Our locations: Fleet GU51 3LA, Reading RG1 1AA</footer>";
  const result = await official.resolveOfficialWebsitePreview(
    { ...query, postcode: "GU51 3LA" },
    {
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(page, { headers: { "content-type": "text/html" } }),
        ),
      lookup,
    },
  );
  expect(result.image).toBeNull();
});

it.each([
  [
    "postcode",
    { address: { addressLocality: "Fleet", postalCode: "GU51 4BB" } },
  ],
  ["coordinates", { geo: { latitude: 51.45, longitude: -0.98 } }],
])(
  "rejects an explicit conflicting %s even when the town matches",
  async (_label, details) => {
    const page =
      html +
      `<script type="application/ld+json">${JSON.stringify({ "@type": "LocalBusiness", name: query.name, ...details })}</script>`;
    const result = await official.resolveOfficialWebsitePreview(
      { ...query, postcode: "GU51 3LA" },
      {
        fetch: vi
          .fn<typeof fetch>()
          .mockResolvedValue(
            new Response(page, { headers: { "content-type": "text/html" } }),
          ),
        lookup,
      },
    );
    expect(result.image).toBeNull();
  },
);

it("finds a physical venue image when the publisher supplies no social sharing image", async () => {
  const page =
    '<title>Little Lantern Play, Fleet</title><img src="/play-room.jpg" alt="The indoor play area interior" width="1600" height="1000">';
  const result = await official.resolveOfficialWebsitePreview(query, {
    fetch: vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(page, { headers: { "content-type": "text/html" } }),
      ),
    lookup,
  });
  expect(result.image).toMatchObject({
    url: "https://littlelantern.co.uk/play-room.jpg",
    rights: "website-preview",
    preview: { kind: "venue-image" },
  });
  expect(approvedPhoto(result.image)?.rights).toBe("website-preview");
});

it("does not infer a physical venue scene from an opaque gallery asset alone", async () => {
  const page =
    '<title>Little Lantern Play, Fleet</title><section class="gallery"><img src="/a123.jpg" alt="Gallery photo" width="1600" height="1000"></section>';
  const result = await official.resolveOfficialWebsitePreview(query, {
    fetch: vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(page, { headers: { "content-type": "text/html" } }),
      ),
    lookup,
  });
  expect(result.image).toBeNull();
});

it("rejects a venue-image record that only claims to be a photographic gallery", () => {
  expect(
    approvedPhoto({
      url: "https://littlelantern.co.uk/a123.jpg",
      source: query.website,
      credit: query.name,
      license: "Website preview — rights reserved",
      rights: "website-preview",
      strategy: "official-website-preview",
      checkedAt: new Date().toISOString(),
      preview: {
        kind: "venue-image",
        pageUrl: query.website,
        publisher: query.name,
        identityEvidence: ["venue and location matched"],
        subjectEvidence: ["photographic venue gallery asset"],
      },
    }),
  ).toBeUndefined();
});

it.each([false, true])(
  "rejects another named branch's schema image even when repeated in body: %s",
  async (inBody) => {
    const page =
      '<title>Little Lantern Play Fleet</title><script type="application/ld+json">' +
      JSON.stringify([
        {
          "@type": "LocalBusiness",
          name: query.name,
          url: query.website,
          address: { postalCode: "GU51 3LA", addressLocality: "Fleet" },
        },
        {
          "@type": "LocalBusiness",
          name: query.name,
          url: "https://littlelantern.co.uk/reading/",
          address: { postalCode: "RG1 1AA", addressLocality: "Reading" },
          image: { url: "/reading-interior.jpg", caption: "Reading interior" },
        },
      ]) +
      "</script>" +
      (inBody
        ? '<img src="/reading-interior.jpg" alt="Reading interior">'
        : "");
    const result = await official.resolveOfficialWebsitePreview(
      { ...query, postcode: "GU51 3LA" },
      {
        fetch: vi
          .fn<typeof fetch>()
          .mockResolvedValue(
            new Response(page, { headers: { "content-type": "text/html" } }),
          ),
        lookup,
      },
    );
    expect(result.image).toBeNull();
  },
);

it("does not borrow a neighboring hydration image's physical-scene caption", async () => {
  const page =
    "<title>Little Lantern Play Fleet</title><script>window.gallery=" +
    JSON.stringify({
      items: [
        { imageUrl: "https://littlelantern.co.uk/a123.jpg", caption: "Latte" },
        {
          imageUrl: "https://littlelantern.co.uk/room.jpg",
          caption: "Play area interior",
        },
      ],
    }) +
    "</script>";
  const result = await official.resolveOfficialWebsitePreview(query, {
    fetch: vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(page, { headers: { "content-type": "text/html" } }),
      ),
    lookup,
  });
  expect(result.image).toBeNull();
});

it("does not borrow a closed parent element's scene description for another image", async () => {
  const page =
    '<title>Little Lantern Play Fleet</title><section class="interior"></section><img src="/a123.jpg" alt="Photo">';
  const result = await official.resolveOfficialWebsitePreview(query, {
    fetch: vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(page, { headers: { "content-type": "text/html" } }),
      ),
    lookup,
  });
  expect(result.image).toBeNull();
});
