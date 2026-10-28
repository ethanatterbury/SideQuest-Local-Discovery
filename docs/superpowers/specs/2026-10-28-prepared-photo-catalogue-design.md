# Prepared venue photo catalogue

SideQuest needs accurate photographs of ordinary local venues, rapid card rendering, no per-visit search credits, and no hosted photo warehouse. The user has delegated implementation and publication to main.

The existing live resolver has failed real ordinary-venue checks. Runtime Tavily searches use one basic-search credit per request and memory-only caching can repeat requests after cold starts. Adding a key alone is not a photo-coverage solution.

Use a durable metadata catalogue containing venue identity, official website candidates, externally hosted image URLs, source credits, checked dates, and evidence. Public routes only read prepared website search results. Tavily is available exclusively to explicit offline maintenance with a monthly attempt ledger and default search allowance zero. A photo's bytes stay on its publisher's host.

Preparation first reads mapped official sites without Tavily. Ambiguous sources remain unresolved. Image-specific analysis evidence can establish a physical scene when an official photograph lacks alt text; it must be recorded separately from HTML metadata and from personal visual inspection. Official identity, branch/location, reserved rights and source credit remain required. No venue-specific runtime conditions.

Approaches considered: live per-card searches repeat credit use and add latency; a paid places-photo provider conflicts with the no-billing constraint; prepared URL metadata permits repeated browsing without new search credits and without image storage. The prepared catalogue is the implementation choice under the user's delegated scope. It cannot guarantee a source photograph exists for every venue or that publisher hosts never block/stop serving an image.
