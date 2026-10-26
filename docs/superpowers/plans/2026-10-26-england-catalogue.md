# England catalogue implementation ledger

User instruction: research, compare approaches and execute autonomously. England replaces the previous UK coverage priority. The existing isolated `work` branch contains this implementation; no visual redesign is included.

- [x] Compare OSM, Overture and All the Places; record evidence and limits in `docs/england-catalogue.md`.
- [x] Reproduce primary-play/café filtering failures; implement one shared map/recommendation rule with evidence-backed primary experiences.
- [x] Compare approved identity-matched photo candidates, preserving prepared renditions of the same original.
- [x] Add an England import command, multipolygon support, disk-backed location caching, coverage smoke gate, catalogue audit and bounded manual CI workflow.
- [ ] Retrieve the real England extract and run fresh photo enrichment: blocked by enforced outbound network policy (Geofabrik returns proxy HTTP 403; media and venue hosts are not allowlisted).
- [ ] Validate full England data, real photo subjects/delivery and recommendation quality across England; cannot be inferred from unit fixtures.
- [ ] Publish a validated England catalogue and integrate the accepted premium design. Rejected concepts are not design approval.

Regression verification includes known primary play, incidental pub playground, ordinary café, same-subject image renditions, rights rejection, local-snapshot rejection, and a real Pyosmium multipolygon fixture. Full unit suite, typecheck, lint and production build are required before committing code. Generated national data is kept separate from the small repository snapshot. The manual CI workflow prepares an artifact; it does not establish a running national refresh/publishing service.

Verification: 268 unit tests / 7 Python checks / typecheck / ESLint / optimized Next build passed. Independent review findings (incidental play promotion and missing artifact photos) resolved. The real England dataset and new photo enrichment remain blocked, not completed.
