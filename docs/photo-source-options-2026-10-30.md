# Photo discovery options checked on 30 October 2026

| Source | What it supplies | Cost/limits checked | Decision |
| --- | --- | --- | --- |
| [TinyFish Search](https://docs.tinyfish.ai/search-api/reference) | Official website search results, not a ready-made photo database | [Pricing](https://www.tinyfish.ai/pricing): free, no card, 30 searches/minute and 500/hour. API reference additionally states 12,000/day, with wallet billing beyond the allowance. | Optional server-only `TINYFISH_API_KEY`. Keep Wallet unfunded and auto-reload off. Only the Search endpoint is called. |
| [TinyFish Fetch](https://docs.tinyfish.ai/fetch-api/reference) | Rendered page text and image links | Pricing: 150 URLs/minute, 1,000 URLs/day | Not wired into browsing. Direct bounded publisher HTML reads avoid consuming this daily allowance. |
| [StedaMaps](https://stedamaps.com/) | OSM listings and image metadata, including Wikimedia photos | $0.50 per 1,000 places, plus $0.50 per 1,000 image-bearing places | Excluded: paid; the demonstrated Commons source does not establish broad local-venue photo coverage. |
| [Wikimedia Commons](https://commons.wikimedia.org/) | Reusable photographs with authorship and licensing | Free; shared infrastructure can throttle lookups | Keep for verified venue-specific photos, especially attractions. Not a complete commercial-venue source. |
| Official venue websites | Their externally hosted venue scenes and declared brand assets | No lookup subscription; availability and hotlink behavior depend on the publisher | Verify identity/location and scene evidence. Prefer real venue scenes. Use a separately labelled official logo fallback. Never substitute another branch's interior. |
| [public-apis/public-apis](https://github.com/public-apis/public-apis) | A directory of APIs | Each listed service has its own coverage, terms and quota | Useful research index; not itself an API or a promise of free photos. |

The user's Reddit post was verified as a TinyFish announcement. Its claim of free search is corroborated by current official pricing, rather than relying on the post alone. The older React Native discussion concerns alternatives to Google Places and does not supply a comprehensive free UK photo service.

The user subsequently raised the 100+ map-results case. Thirty searches per minute cannot discover a distinct missing website for each of 100 cold venues immediately. Map pins do not cause one search each, but this is still a real first-visit limitation. TinyFish remains optional and disabled without a key; it is not the primary photo source or a prerequisite for this release. No signup is required for the direct-site, logo, retained-link and broken-image-recovery changes.

## Implemented delivery

Images load directly from their original image hosts using unoptimized image elements. SideQuest does not download a national image library, proxy these images through Vercel Image Optimization, or add another storage service. Small bounded browser records retain successfully decoded URLs and source metadata. Broken URLs are removed from those records and excluded from a replacement lookup.

Official logos are discovered from publisher markup, without a Starbucks/Costa/business-specific URL table. A live publisher-page extraction check found the current Starbucks UK apple-touch icon via that generic code. It is labelled `Official logo`, uses a contain crop, and is not described as a photograph of the selected branch.

Prepared URL hints are used before optional free search. Search responses are capped at 256KB; identical requests share work; process-local caches, 30/minute and 500/hour admission bounds, concurrency limits and provider cooldowns constrain requests. Those process-local controls are not a global account quota counter: the provider enforces account-wide limits. Keeping the Wallet unfunded prevents over-allowance requests from drawing funds. There is no paid-provider fallback.

## What this does not establish

First-time discovery can take seconds and an external host can fail. Neither the source research nor the tests establishes accurate-photo coverage for every UK venue. Existing verified URLs are the fast path; the optional free search improves discovery where a website was missing. No single surveyed free source guarantees every local venue, immediate first-load delivery and unrestricted hosting availability.

## Map imagery

The layers control retains the same map instance, camera and venue source. Landscape and Street use the current vector basemap; Satellite uses EOX's public 10m Sentinel-2 mosaic, labelled 2016. Its [WMTS capabilities](https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml) identify `s2cloudless_3857` and CC BY 4.0. It is not current high-resolution aerial photography. Attribution remains in the compact map credit.
