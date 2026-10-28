# Prepared Photo Catalogue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Reuse verified venue photo URLs without spending search credits while browsing, and deliver genuine ordinary-venue photo improvements.

**Architecture:** A durable metadata manifest supplies website candidates and approved photos. Explicit offline preparation performs bounded source lookups and conservatively reserves every Tavily attempt before network access. Image bytes stay externally hosted.

**Tech Stack:** Existing Next.js 16.4, TypeScript, Node tooling, Vitest, Playwright and GitHub/Vercel deployment.

**Spec:** docs/superpowers/specs/2026-10-28-prepared-photo-catalogue-design.md

## Global Constraints

- No billing setup, per-visit Tavily searches, photo warehouse, stock substitutes or venue-specific runtime exceptions.
- Existing branch identity and photo-rights validation remain active.
- A prepared URL is not a guarantee of instant third-party delivery or exhaustive England coverage.

## Review Focus

- Repeated public requests with a configured key must issue zero Tavily network requests.
- Rename, relocation, other branch or malformed prepared metadata must not reuse a photo.
- Failed/reserved searches survive reruns and cannot exceed the explicit batch/month allowance.
- A transient refresh cannot erase a previously approved photo.
- Image-analysis evidence must describe the exact publisher image, not pretend to be an HTML caption or personal inspection.

### Task 1: Prepared runtime metadata

Files: src/providers/prepared-venue-photos.ts, official-website-discovery.ts, photo-index.ts; tests/prepared-venue-photos.test.ts and official-website-discovery.test.ts.

- [x] Write and run failing public-zero-network and exact-identity reuse tests.
- [x] Add durable manifest readers; separate explicit maintenance search from public discovery.
- [x] Integrate approved prepared photos with existing catalogue delivery.
- [x] Verify focused tests and public route behavior.

### Task 2: Bounded offline preparation

Files: scripts/prepare-venue-photos.mjs, scripts/lib/venue-photo-batch.mjs and batch tests.

- [x] Test mapped-site zero-credit preparation, durable attempt reservations, reruns, limits and preserved good photos.
- [x] Implement a metadata-only resumable command with default max-searches=0, monthly maximum1000 and an exclusive ledger lock.
- [x] Document operation and limitations; no implicit deployment-time searches.

### Task 3: Real photo evidence and release

Files: domain image review contract, photo-policy, metadata manifest and source evidence tests.

- [x] Record explicit image-specific analysis evidence from official publisher photos without inventing alt text or personal visual review.
- [x] Verify generic source/identity checks and add real approved photo metadata.
- [x] Run lint, types, all unit tests, build, relevant browser checks and independent review.
- [ ] Commit/push main and verify deployed photos and zero public Tavily calls.

## Verification record

- Public100query configured-key test issues zero fetches.
- Full lint/typecheck/unit run:413tests passed; production build passed.
- Production-mode photo retry and website-preview browser tests:2passed.
- Independent reviewer:62focused checks passed; no Critical/Important findings.
- Nine approved publisher URLs resolve through ordinary normalized catalogue integration; Mini Town stays unresolved pending reproducible branch evidence.
- Release decision: publish prepared-photo runtime and maintenance first; publish the national importer only after compressed server-cell delivery avoids the Vercel function bundle limit. No source-image bytes are added.
