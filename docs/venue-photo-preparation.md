# Venue photos without per-visit searches

Photo preparation runs separately from browsing. It reads venues' mapped official websites, checks the venue and branch identity, and stores approved external image URLs plus evidence. Images stay on the publisher's servers. Loading those links does not use Tavily credits or require a photo storage account.

Public `discoverOfficialWebsite` only reads prepared metadata. Even setting `TAVILY_API_KEY` in Production cannot make public requests spend search credits. Do not add a search key to Vercel for this process.

## Free maintenance

The **Maintain prepared venue photographs** GitHub Actions workflow works through the catalogue with `--max-searches=0`. It needs no additional account or API key. It keeps results between runs, tests actual publisher image delivery in Chromium, and publishes approved changes to main. Failed delivery checks keep their screenshots and diagnostics as workflow artifacts. New photos that fail browser checks remain unresolved, while successful photos and preparation checkpoints can still be published.

The hourly job inspects up to 1,000 venues within a 20-minute preparation budget. Activities are prepared before optional food, drink and retail listings. This is a resumable processing batch, not a monthly request allowance. The England catalogue is supplied as compressed OpenStreetMap metadata; it contains links and listings, not an image warehouse.

For eligible images with unhelpful filenames or captions, an isolated CPU CLIP model checks their visual subject. The model needs no inference API key or per-image credits. Image bytes are downloaded into memory, inspected, then discarded; only the publisher URL and evidence are stored. Official venue/location and image-specific chain-branch checks run before classification. Classification cannot establish venue identity by itself. A completed 26-image pilot averaged about 157 ms per image on its runner; this is not a national accuracy or total crawl-time guarantee. The production threshold is more conservative than the pilot.

Browser verification covers every new or changed photo. Unchanged successful delivery evidence is reused for 30 days. Up to 12 hero JPEG screenshots are kept per run; evidence artifacts expire after one day. The site revalidates its catalogue manifest so new photo links do not wait behind a day-old manifest.

To run locally:

```sh
npm run prepare:photos -- --limit=100 --max-searches=0
# Optional local CPU image checks (requires the isolated dependencies):
ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm ci --prefix scripts/photo-vision
npm run prepare:photos -- --limit=1000 --max-searches=0 --local-vision=true
npm run check
```

The manifest is `src/providers/data/venue-photo-previews.json`. The separate search ledger is `src/providers/data/venue-photo-search-ledger.json`. Commit metadata changes together. Do not delete the ledger or run parallel jobs with different ledgers for the same optional search account.

## Optional website search

Tavily is optional maintenance tooling for venues whose official website is missing from the source data. It is not an image subscription: a basic search costs one credit and may return multiple website candidates. Neither serving a prepared place nor fetching its publisher image calls Tavily.

The command defaults to **zero** searches. An explicitly configured maintenance key and a positive `--max-searches` allowance are both required. Every attempted search is reserved in the durable ledger before the request, including failures. The default monthly allowance is 1,000 and can only be lowered. Reserved and failed attempts also suppress repeated searches for 30 days. This local allowance does not cover other applications sharing the account; leave paid usage disabled at the provider.

## Photo accuracy and delivery

Website preview images retain their owner's rights and carry a source link. Stored evidence distinguishes on-page photo metadata, personal visual review, and external image-specific analysis. A reviewed image is tied to its exact URL, venue name, identity and coordinates. The runtime never contains a special case for a named play café.

Logos, generic illustrations and unrelated branch images do not count as coverage. Unresolved venues stay unresolved instead of receiving a plausible stock photo. A source URL is checked separately from actual browser decoding: publisher outages, removed files and blocked external embedding are visible test failures. Direct publisher delivery avoids an image warehouse but remains dependent on that publisher's speed and availability.
