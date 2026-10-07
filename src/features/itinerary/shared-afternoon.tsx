"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useApp } from "@/components/providers";
import { buildItinerary } from "@/domain/itinerary";
import { PLACES } from "@/providers/places";
import { ItineraryDialog } from "./itinerary";
import { EmptyState } from "@/components/primitives";
import { validatedPreferences } from "@/providers/persistence";
import { DEFAULT_QUERY, type Itinerary } from "@/domain/models";
export function SharedAfternoon() {
  const { env, state, ready } = useApp();
  const [plan, setPlan] = useState<Itinerary | null>(null),
    [error, setError] = useState(""),
    [open, setOpen] = useState(true);
  useEffect(() => {
    if (!ready) return;
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
      const p = buildItinerary(
        PLACES,
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
      setError(
        "This afternoon couldn’t be loaded. The link may be incomplete, or the plans no longer fit the conditions.",
      );
    } // Rebuild only once against current initial environment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  return (
    <div className="page-container">
      <EmptyState
        title={
          error ? "That plan took a wrong turn." : "Fancy a little SideQuest?"
        }
        text={
          error ||
          "A little afternoon, shared with you. Check the current conditions before you go."
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
