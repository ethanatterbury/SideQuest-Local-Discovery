"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useApp } from "@/components/providers";
import { buildItinerary } from "@/domain/itinerary";
import { ItineraryDialog } from "./itinerary";
import { EmptyState } from "@/components/primitives";
import { validatedPreferences } from "@/providers/persistence";
import { mergeCatalog } from "@/providers/place-catalog";
import { DEFAULT_QUERY, type Itinerary } from "@/domain/models";
export function SharedAfternoon() {
  const {
    places: catalog,
    catalogReady,
    env,
    state,
    ready,
    rememberPlaces,
  } = useApp();
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<Itinerary | null>(null),
    [error, setError] = useState(""),
    [open, setOpen] = useState(true);
  useEffect(() => {
    if (!ready || !catalogReady) return;
    const controller = new AbortController();
    async function load() {
      try {
        const raw = new URLSearchParams(location.search).get("plan");
        if (!raw || raw.length > 8000) throw Error("Invalid link");
        const data = JSON.parse(raw);
        if (
          !data.origin ||
          typeof data.origin.name !== "string" ||
          !Number.isFinite(data.origin.lat) ||
          Math.abs(data.origin.lat) > 90 ||
          !Number.isFinite(data.origin.lng) ||
          Math.abs(data.origin.lng) > 180 ||
          !Number.isFinite(Date.parse(data.start))
        )
          throw Error("Invalid plan");
        const q = { ...DEFAULT_QUERY, ...validatedPreferences(data.query) };
        const start =
          new Date(data.start).getTime() < Date.now() - 86400000
            ? env.now
            : data.start;
        let sharedCatalog = catalog;
        // Fetch the sender's area, independent of the recipient's current town.
        if (
          !env.failures.includes("offline") &&
          !env.failures.includes("places")
        ) {
          try {
            const radius = Math.min(
              50,
              Math.max(3, q.travel * (q.travelMode === "walk" ? 0.065 : 0.6)),
            );
            const response = await fetch(
              `/api/places?lat=${data.origin.lat}&lng=${data.origin.lng}&radius=${radius}`,
              { signal: controller.signal },
            );
            if (response.ok) {
              const result = await response.json();
              if (Array.isArray(result.places)) {
                sharedCatalog = mergeCatalog(catalog, result.places);
                if (!controller.signal.aborted) rememberPlaces(result.places);
              }
            }
          } catch {
            if (controller.signal.aborted) return;
          }
        }
        if (controller.signal.aborted) return;
        const p = buildItinerary(
          sharedCatalog,
          q,
          {
            ...env,
            location: { ...data.origin, name: data.origin.name.slice(0, 100) },
            now: start,
          },
          state,
          {
            food: data.food === true,
            skip: Array.isArray(data.skip)
              ? data.skip.filter((s: unknown) => typeof s === "string")
              : [],
            start,
          },
        );
        if (!p) throw Error("This shared plan no longer fits the conditions.");
        setPlan(p);
      } catch {
        if (controller.signal.aborted) return;
        setError(
          "This afternoon couldn’t be loaded. The link may be incomplete, or the plans no longer fit the conditions.",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
    // Rebuild once, after the shared area has loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, catalogReady]);
  return (
    <div className="page-container">
      <EmptyState
        title={
          error
            ? "That plan took a wrong turn."
            : loading
              ? "Finding this afternoon…"
              : "Fancy a little SideQuest?"
        }
        text={
          error ||
          (loading
            ? "Loading places around the shared starting point."
            : "A little afternoon, shared with you. Check the current conditions before you go.")
        }
      >
        {plan && (
          <button className="button" onClick={() => setOpen(true)}>
            See this afternoon
          </button>
        )}
        <Link className="button secondary" href="/">
          Find a new idea
        </Link>
      </EmptyState>
      {plan && open && (
        <ItineraryDialog initial={plan} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}
