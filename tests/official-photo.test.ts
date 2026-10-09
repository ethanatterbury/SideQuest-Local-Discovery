import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assessOfficialPhotoSubject,
  downloadOfficialPhoto,
  isPublicPhotoAddress,
  officialPhotoCandidateAllowed,
  parseOfficialPhotoHtml,
  resolveOfficialPhotos,
  safeOfficialPhotoUrl,
  type OfficialPhotoLookup,
  type OfficialPhotoQuery,
} from "../src/providers/official-photo";

const page = "https://venue.co.uk/wokingham/";
const query: OfficialPhotoQuery = {
  name: "Pirates Landing",
  area: "Wokingham",
  lat: 51.41,
  lng: -0.84,
  website: page,
};
const publicLookup = vi.fn<OfficialPhotoLookup>(async () => [
  { address: "93.184.215.14", family: 4 },
]);
const validHtml =
  '<title>Pirates Landing Wokingham</title><img class="hero" src="/building.jpg" width="1482" height="988">';
const htmlResponse = (html = validHtml) =>
  new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  publicLookup.mockClear();
});

describe("official image ingestion download", () => {
  it("downloads allowed image bytes and keeps the final provenance URL", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://cdn.venue.co.uk/building.jpg" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(bytes, { headers: { "content-type": "image/jpeg" } }),
      );
    const image = await downloadOfficialPhoto(
      "https://venue.co.uk/building.jpg",
      { fetch: fetcher, lookup: publicLookup },
    );
    expect(image).toMatchObject({
      contentType: "image/jpeg",
      url: "https://cdn.venue.co.uk/building.jpg",
    });
    expect(image?.buffer).toEqual(Buffer.from(bytes));
    expect(publicLookup.mock.calls.map(([host]) => host)).toEqual([
      "venue.co.uk",
      "cdn.venue.co.uk",
    ]);
  });

  it("rejects private downloads and private redirect DNS before that request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://cdn.venue.co.uk/building.jpg" },
      }),
    );
    expect(
      await downloadOfficialPhoto("https://127.0.0.1/building.jpg", {
        fetch: fetcher,
        lookup: publicLookup,
      }),
    ).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    const lookup = vi.fn(async (host: string) => [
      { address: host.startsWith("cdn.") ? "10.0.0.1" : "8.8.8.8", family: 4 },
    ]);
    expect(
      await downloadOfficialPhoto("https://venue.co.uk/building.jpg", {
        fetch: fetcher,
        lookup,
      }),
    ).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects SVG, HTML, empty and oversized images with declared or streamed size", async () => {
    const responses = [
      new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }),
      htmlResponse(),
      new Response(null, { headers: { "content-type": "image/png" } }),
      new Response("small", {
        headers: { "content-type": "image/webp", "content-length": "8000001" },
      }),
      new Response(new Uint8Array(8_000_001), {
        headers: { "content-type": "image/avif" },
      }),
    ];
    for (const response of responses)
      expect(
        await downloadOfficialPhoto("https://venue.co.uk/building.jpg", {
          fetch: vi.fn<typeof fetch>().mockResolvedValue(response),
          lookup: publicLookup,
        }),
      ).toBeNull();
  });

  it("cancels a body that never finishes within the deadline", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), {
      headers: { "content-type": "image/jpeg" },
    });
    const result = downloadOfficialPhoto("https://venue.co.uk/building.jpg", {
      fetch: vi.fn<typeof fetch>().mockResolvedValue(response),
      lookup: publicLookup,
      timeoutMs: 10,
    });
    await vi.advanceTimersByTimeAsync(11);
    expect(await result).toBeNull();
    expect(cancel).toHaveBeenCalled();
  });
});

describe("official website photo extraction", () => {
  it("prioritizes venue interiors over food heroes and generic gallery images", () => {
    const html = `<title>Pirates Landing Wokingham</title>
      <meta property="og:image" content="https://venue.co.uk/food-hero.jpg">
      <img class="hero" src="/food-hero.jpg" width="2400" height="1600" alt="Our delicious pizza and burgers">
      <section class="gallery"><img src="/IMG0100.jpg" width="1400" height="900" alt="Dining room interior">
      <img src="/IMG0200.jpg" width="2400" height="1600" alt="Gallery photograph"></section>`;
    const result = parseOfficialPhotoHtml(html, page, query);
    expect(result.candidates.map((candidate) => candidate.url)).toEqual([
      "https://venue.co.uk/IMG0100.jpg",
      "https://venue.co.uk/IMG0200.jpg",
    ]);
    expect(result.candidates[0].photoScore).toBeGreaterThan(
      result.candidates[1].photoScore,
    );
    expect(result.candidates.every(officialPhotoCandidateAllowed)).toBe(true);
  });

  it("returns no photos for brand art, promotions, app graphics and unexplained hero/schema images", () => {
    const html = `<title>Pirates Landing Wokingham</title>
      <meta property="og:image" content="https://venue.co.uk/pirates-landing.png">
      <img class="hero" src="/pirates-landing.png" width="1500" height="1000">
      <div class="hero" style="background-image:url('/40-percent-off-food.jpg')"></div>
      <img class="gallery" src="/poppins+logo+2019.jpg">
      <img class="gallery" src="/app-store-download.jpg">
      <script type="application/ld+json">{"@type":"LocalBusiness","name":"Pirates Landing","image":"/1234.jpg"}</script>`;
    expect(parseOfficialPhotoHtml(html, page, query).candidates).toEqual([]);
    expect(
      officialPhotoCandidateAllowed({ photoScore: 0, subjectEvidence: [] }),
    ).toBe(false);
    expect(
      officialPhotoCandidateAllowed({
        photoScore: Number.NaN,
        subjectEvidence: ["gallery"],
      }),
    ).toBe(false);
  });

  it("rejects clearly non-place subjects even in gallery markup and recognizes real scenes", () => {
    for (const context of [
      "Coffee logo",
      "Special offers",
      "Brand artwork",
      "Staff portrait",
      "Cocktail drinks",
      "Burger closeup",
      "Menu",
      "Live music tribute night",
    ])
      expect(
        assessOfficialPhotoSubject(
          { url: "https://venue.co.uk/gallery/1234.jpg", context },
          query,
        ).accepted,
        context,
      ).toBe(false);
    expect(
      assessOfficialPhotoSubject(
        {
          url: "https://venue.co.uk/1234.png",
          context: "Restaurant dining room interior",
        },
        query,
      ),
    ).toMatchObject({ accepted: true, photoScore: 90 });
    expect(
      assessOfficialPhotoSubject(
        {
          url: "https://venue.co.uk/hero.jpg",
          context: "Restaurant hero banner",
        },
        query,
      ).accepted,
    ).toBe(false);
  });

  it("does not borrow physical scene evidence from an adjacent image when parsing backgrounds", () => {
    const html =
      '<title>Pirates Landing Wokingham</title><img alt="Building exterior" src="/building.jpg"><div class="hero" style="background-image:url(\'/unknown.jpg\')"></div>';
    expect(
      parseOfficialPhotoHtml(html, page, query).candidates.map(
        (candidate) => candidate.url,
      ),
    ).toEqual(["https://venue.co.uk/building.jpg"]);
  });

  it("matches ordinary brand possessives, cuisine descriptors and centre spelling without weakening branch identity", () => {
    for (const [name, title] of [
      ["Ruby's Play Cafe", "The Ruby Play Cafe"],
      ["Fenixia Chinese Restaurant", "Fenixia Restaurant"],
      ["Hawley Lake Sail Training Center", "Hawley Lake Sail Training Centre"],
    ]) {
      expect(
        parseOfficialPhotoHtml(
          `<title>${title}</title><img class="gallery" src="/building.jpg">`,
          page,
          { ...query, name },
        ).identity.matchedName,
        name,
      ).toBe(true);
    }
    expect(
      parseOfficialPhotoHtml(
        '<title>Zizzi Reading</title><img class="gallery" src="/building.jpg">',
        "https://zizzi.co.uk/reading/",
        { ...query, name: "Zizzi", area: "Camberley" },
      ).candidates,
    ).toEqual([]);
  });

  it("accepts proven WordPress gallery srcsets even when thumbnail alt text is blank", () => {
    const result = parseOfficialPhotoHtml(
      '<title>Camberley – Pirates Landing</title><img width="190" height="190" src="/wp-content/uploads/pl-98-190x190.jpg" class="attachment-thumbnail size-thumbnail" alt="" srcset="/wp-content/uploads/pl-98-190x190.jpg 190w, /wp-content/uploads/pl-98-1024x1024.jpg 1024w">',
      "https://pirateslanding.co.uk/pirates-landing-camberley/",
      { ...query, area: "Camberley" },
    );
    expect(result.candidates.map((candidate) => candidate.url)).toEqual([
      "https://pirateslanding.co.uk/wp-content/uploads/pl-98-1024x1024.jpg",
    ]);
  });

  it("matches a chain's area-named Restaurant schema only on the exact named branch page", () => {
    const html =
      '<title>Zizzi Camberley</title><script type="application/ld+json">{"@type":"Restaurant","name":"Camberley","url":"https://zizzi.co.uk/camberley/","image":{"url":"https://cdn.sanity.io/images/ysupxjc9/production/123-1920x1080.png","caption":"Camberley dining room interior"}}</script><script>window.data={"url":"https://zizzi.co.uk/","name":"Restaurant gallery"}</script>';
    const result = parseOfficialPhotoHtml(
      html,
      "https://zizzi.co.uk/camberley/",
      { ...query, name: "Zizzi", area: "Camberley" },
    );
    expect(result.candidates.map((candidate) => candidate.url)).toEqual([
      "https://cdn.sanity.io/images/ysupxjc9/production/123-1920x1080.png",
    ]);
    expect(result.rejected["not-image-url"]).toBeGreaterThan(0);
    expect(
      parseOfficialPhotoHtml(html, "https://zizzi.co.uk/reading/", {
        ...query,
        name: "Zizzi",
        area: "Camberley",
      }).candidates,
    ).toEqual([]);
  });

  it("uses the actual WordPress hero and linked/srcset originals, discarding cropped thumbnails and branding", () => {
    const html = readFileSync(
      new URL(
        "./fixtures/official-photo/wordpress-venue.html",
        import.meta.url,
      ),
      "utf8",
    );
    const result = parseOfficialPhotoHtml(
      html,
      "https://pirateslanding.co.uk/wokingham/",
      query,
    );
    expect(result.identity).toMatchObject({
      matchedName: true,
      matchedArea: true,
      branchSpecific: true,
    });
    expect(result.candidates.map((image) => image.url)).toEqual([
      "https://pirateslanding.co.uk/wp-content/uploads/2024/03/wokingham-pl-building.jpg",
      "https://pirateslanding.co.uk/wp-content/uploads/2024/03/wokingham-play-frame.jpg",
      "https://pirateslanding.co.uk/wp-content/uploads/2024/03/wokingham-slide.jpg",
    ]);
    expect(result.candidates[0]).toMatchObject({
      width: 1482,
      license: "Venue website — rights reserved",
      strategy: "official-website",
    });
    expect(result.rejected["small-or-banner-art"]).toBeGreaterThan(0);
    expect(result.rejected["branding-map-or-stock"]).toBeGreaterThan(0);
  });

  it("extracts lazy, CSS background, schema and hydration gallery assets with matching subject evidence", () => {
    const html = `<title>Pirates Landing Wokingham</title>
      <img class="gallery" data-lazy-src="/interior.jpg?size=1200&amp;quality=80" width="1200" height="800">
      <div class="hero" style="background-image:url('/building.webp')"></div>
      <div class="gallery" data-background="/playground.jpg"></div>
      <script type="application/ld+json">{"@type":"LocalBusiness","name":"Pirates Landing","address":{"addressLocality":"Wokingham"},"image":{"@type":"ImageObject","url":"/venue-interior.jpg","width":1400,"height":900}}</script>
      <script>window.gallery={"originalUrl":"https://cdn.venue.co.uk/gallery/frame.jpg"}</script>`;
    const result = parseOfficialPhotoHtml(html, page, query);
    expect(result.candidates.map((image) => image.url)).toEqual(
      expect.arrayContaining([
        "https://venue.co.uk/interior.jpg?size=1200&quality=80",
        "https://venue.co.uk/building.webp",
        "https://venue.co.uk/playground.jpg",
        "https://venue.co.uk/venue-interior.jpg",
        "https://cdn.venue.co.uk/gallery/frame.jpg",
      ]),
    );
    expect(result.candidates).toHaveLength(5);
  });

  it("requires the named venue and the specific branch for multi-location operators", () => {
    const chain = { ...query, name: "Costa Coffee" };
    const generic =
      '<title>Costa Coffee</title><h1>Our locations</h1><img class="hero" src="/building.jpg">';
    expect(
      parseOfficialPhotoHtml(generic, "https://costa.co.uk/", chain),
    ).toMatchObject({
      candidates: [],
      identity: { multiBranch: true, branchSpecific: false },
    });
    expect(
      parseOfficialPhotoHtml(
        generic.replace(
          "Costa Coffee</title>",
          "Costa Coffee Wokingham</title>",
        ),
        "https://costa.co.uk/wokingham/",
        chain,
      ).candidates,
    ).toHaveLength(1);
    expect(
      parseOfficialPhotoHtml(
        '<title>Another venue</title><img class="hero" src="/building.jpg">',
        page,
        query,
      ).candidates,
    ).toEqual([]);
  });

  it("rejects another structured venue, menu artwork, stock images, map thumbnails and unexplained images", () => {
    const html = `<title>Pirates Landing Wokingham</title>
      <script type="application/ld+json">{"@type":"Restaurant","name":"Different Restaurant","image":"/restaurant-other.jpg"}</script>
      <img class="hero" src="/menu.jpg"><img class="hero" src="https://images.unsplash.com/restaurant.jpg">
      <img class="hero" src="https://lh3.googleusercontent.com/restaurant.jpg"><img src="/DSC1234.jpg">
      <img class="hero" src="/banner.jpg" width="1600" height="180">`;
    expect(parseOfficialPhotoHtml(html, page, query).candidates).toEqual([]);
  });

  it("handles malformed schema and URL escapes without losing valid photos", () => {
    const result = parseOfficialPhotoHtml(
      `${validHtml}<img class="gallery" src="/%E0%A4%A.jpg"><script type="application/ld+json">oops</script>`,
      page,
      query,
    );
    expect(result.candidates).toHaveLength(2);
    expect(result.rejected["invalid-schema"]).toBe(1);
  });
});

describe("official website transport guards", () => {
  it("rejects private, local, mapped, documentation and transition addresses in canonical or expanded form", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "192.168.1.1",
      "172.16.0.1",
      "169.254.169.254",
      "100.64.0.1",
      "198.18.0.1",
      "192.0.2.1",
      "203.0.113.2",
      "::1",
      "::ffff:8.8.8.8",
      "fc00::1",
      "fe80::1",
      "2001:db8::1",
      "2001:0db8::1",
      "2001:0000::1",
      "2002:0808:0808::1",
    ])
      expect(isPublicPhotoAddress(address), address).toBe(false);
    for (const address of [
      "8.8.8.8",
      "93.184.215.14",
      "2606:4700:4700::1111",
      "2001:4860:4860::8888",
    ])
      expect(isPublicPhotoAddress(address), address).toBe(true);
  });

  it("rejects unsafe URL forms before DNS or fetch", async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const website of [
      "https://127.0.0.1/",
      "https://2130706433/",
      "https://0x7f000001/",
      "https://[::1]/",
      "https://internal.local/",
      "https://user:pass@venue.co.uk/",
      "https://venue.co.uk:8443/",
      "https://venue.co.uk\\@127.0.0.1/",
      "file:///etc/passwd",
    ]) {
      expect(safeOfficialPhotoUrl(website), website).toBe(false);
      expect(
        (
          await resolveOfficialPhotos(
            { ...query, website },
            { fetch: fetcher, lookup: publicLookup },
          )
        ).reason,
      ).toBe("unsafe-url");
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect(publicLookup).not.toHaveBeenCalled();
  });

  it("rejects all DNS answers when even one is private before the website request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const lookup = vi.fn(async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]);
    const result = await resolveOfficialPhotos(query, {
      fetch: fetcher,
      lookup,
    });
    expect(result.reason).toBe("unsafe-dns-address");
    expect(result.requestCount).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("validates every manual redirect before I/O and prohibits automatic redirect bypasses", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://127.0.0.1/private" },
      }),
    );
    expect(
      (
        await resolveOfficialPhotos(query, {
          fetch: fetcher,
          lookup: publicLookup,
        })
      ).reason,
    ).toBe("unsafe-redirect");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
    const followed = htmlResponse();
    Object.defineProperty(followed, "url", { value: "https://other.co.uk/" });
    fetcher.mockResolvedValue(followed);
    expect(
      (
        await resolveOfficialPhotos(query, {
          fetch: fetcher,
          lookup: publicLookup,
        })
      ).reason,
    ).toBe("unexpected-redirect");
  });

  it("checks redirected hosts, limits redirect loops, and upgrades old HTTP websites to HTTPS", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: "/again" } }),
      );
    const result = await resolveOfficialPhotos(
      { ...query, website: page.replace("https:", "http:") },
      { fetch: fetcher, lookup: publicLookup },
    );
    expect(result.reason).toBe("unsafe-redirect");
    expect(result.requestCount).toBe(5);
    expect(fetcher.mock.calls[0][0]).toBe(page);
    expect(publicLookup).toHaveBeenCalledTimes(5);
  });

  it("keeps a safe venue image and rejects a CDN resolving to private space", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        htmlResponse(
          `${validHtml}<img class="gallery" src="https://cdn.venue.co.uk/park.jpg">`,
        ),
      );
    const lookup = vi.fn(async (host: string) => [
      {
        address: host.startsWith("cdn.") ? "192.168.1.1" : "8.8.8.8",
        family: 4,
      },
    ]);
    const result = await resolveOfficialPhotos(query, {
      fetch: fetcher,
      lookup,
    });
    expect(result.candidates.map((image) => image.url)).toEqual([
      "https://venue.co.uk/building.jpg",
    ]);
    expect(result.reason).toBeNull();
    expect(result.rejected["unsafe-image-dns"]).toBe(1);
  });

  it("rejects non-HTML and oversized responses, including undeclared streamed bodies", async () => {
    for (const response of [
      new Response("image", { headers: { "content-type": "image/jpeg" } }),
      new Response("small", {
        headers: { "content-type": "text/html", "content-length": "2000001" },
      }),
      htmlResponse("x".repeat(2_000_001)),
    ]) {
      const result = await resolveOfficialPhotos(query, {
        fetch: vi.fn<typeof fetch>().mockResolvedValue(response),
        lookup: publicLookup,
      });
      expect(result.reason).toBe(
        response.headers.get("content-type") === "image/jpeg"
          ? "website-content-type"
          : "html-too-large",
      );
    }
  });

  it("bounds hanging DNS and fetch operations and honors a pre-aborted caller", async () => {
    vi.useFakeTimers();
    const hanging = () => new Promise<never>(() => {});
    const fetcher = vi.fn<typeof fetch>(hanging);
    const dnsResult = resolveOfficialPhotos(query, {
      fetch: fetcher,
      lookup: hanging,
      timeoutMs: 10,
    });
    await vi.advanceTimersByTimeAsync(11);
    expect((await dnsResult).reason).toBe("timeout-or-abort");
    expect(fetcher).not.toHaveBeenCalled();
    const fetchResult = resolveOfficialPhotos(query, {
      fetch: fetcher,
      lookup: publicLookup,
      timeoutMs: 10,
    });
    await vi.advanceTimersByTimeAsync(11);
    expect((await fetchResult).reason).toBe("timeout-or-abort");
    const controller = new AbortController();
    controller.abort();
    const aborted = await resolveOfficialPhotos(query, {
      fetch: fetcher,
      lookup: publicLookup,
      signal: controller.signal,
    });
    expect(aborted.reason).toBe("timeout-or-abort");
    expect(aborted.requestCount).toBe(0);
  });
});
