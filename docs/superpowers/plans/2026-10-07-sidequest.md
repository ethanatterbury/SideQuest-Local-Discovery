# SideQuest Implementation Plan

> Execution: native in this session, per delegated decisions in the brief. Use superpowers:executing-plans.
> **Goal:** Ship a complete useful local-first discovery app.
> **Architecture:** normalized pure domain functions; replaceable provider interfaces; React environment and persistence boundaries; server App Router shell.
> **Tech Stack:** Next.js 16.4, React 19, strict TypeScript, MapLibre, CSS tokens, Vitest, Playwright.
> **Spec:** docs/superpowers/specs/2026-10-07-sidequest-design.md

## Global constraints

No Supabase or auth. No fabricated live facts. Dynamic location. Unknown hours explicit. Travel estimates labelled. Accessible 44px controls. Reduced motion and offline graceful degradation.

## Review focus

Night woodland excluded; weather-unavailable does not pretend clear; denied geolocation opens fallback; blocked storage remains usable; shared malformed query never crashes.

## Tasks

1. Domain/data: src/domain/{models,discovery,itinerary,environment}.ts and src/providers/*.ts. Tests assert daylight/weather exclusions, closing on arrival, budget and duration hard limits, proximity, parser and persistence recovery. Write/run failing tests before implementations.
2. Discover: src/features/discover and app shell; editorial first viewport, dynamic headline, refinement, ranked cards, signature reveal. Verify keyboard and mobile.
3. Map/lab: src/features/map and environment-lab; MapLibre cluster/selection/radius/route, weather overlay and all simulations. Tests cover context merging and failure independence.
4. Place/local library: server place routes, detail actions, collection/history adapters, portable share and directions. Verify reload and sharable URL.
5. PWA/quality: manifest/icons/service worker, README/provider docs, viewport matrix and smoke tests; npm run check and test:e2e. Commit verified deliverable; publish only within authorized repository scope.
