"use client";
import Link from "next/link";
import { useMemo, useState, useEffect, useRef } from "react";
import {
  ArrowRight,
  Shuffle,
  Route,
  Search,
  Map as MapIcon,
} from "lucide-react";
import { useApp } from "@/components/providers";
import { EmptyState } from "@/components/primitives";
import { TOWNS } from "@/providers/geocoding";
import { rankPlaces, effectiveDiscoveryQuery } from "@/domain/discovery";
import { PlaceCard } from "./place-card";
import { Refinement } from "./refinement";
import { Signature } from "./signature";
import { ItineraryDialog } from "@/features/itinerary/itinerary";
export function Discover({ explore = false }: { explore?: boolean }) {
  const {
    places: catalog,
    placesStatus,
    placesMessage,
    refreshPlaces,
    env,
    query,
    setQuery,
    state,
    setLocation,
    ready,
    update,
  } = useApp();
  const [signature, setSignature] = useState<"escape" | "surprise" | null>(
      null,
    ),
    [plan, setPlan] = useState(false),
    [collection, setCollection] = useState("Good right now");
  const [visibleCount, setVisibleCount] = useState(12);
  useEffect(() => setVisibleCount(12), [query, collection]);
  const effective = useMemo(() => {
    let q = effectiveDiscoveryQuery(query, catalog);
    if (collection === "Actually free") q = { ...q, budget: 0 };
    if (collection === "Hidden nearby") q = { ...q, mode: "surprise" };
    if (collection === "Rain won’t ruin these")
      q = { ...q, environment: "indoor" };
    if (collection === "Worth the drive") q = { ...q, travel: 90 };
    return q;
  }, [query, collection, catalog]);
  // Impression scoring is stable for this visit; new impressions affect the next visit.
  const [visitImpressions, setVisitImpressions] = useState<{
    captured: boolean;
    items: { id: string; date: string }[];
  }>({ captured: false, items: [] });
  useEffect(() => {
    if (ready && !visitImpressions.captured)
      setVisitImpressions({ captured: true, items: state.impressions ?? [] });
  }, [ready, visitImpressions.captured, state.impressions]);
  const impressionState = useMemo(
    () => ({ ...state, impressions: visitImpressions.items }),
    [state, visitImpressions.items],
  );
  const ranked = useMemo(
    () => rankPlaces(catalog, effective, env, impressionState),
    [catalog, effective, env, impressionState],
  );
  const nameMatches = query.text
    ? ranked.filter((r) =>
        `${r.place.name} ${r.place.area} ${r.place.category}`
          .toLowerCase()
          .includes(query.text.toLowerCase()),
      )
    : [];
  const results = nameMatches.length ? nameMatches : ranked;
  const shown = useRef(new Set<string>());
  const impressions = useRef<string[]>([]);
  useEffect(() => {
    impressions.current = results.slice(0, visibleCount).map((r) => r.place.id);
    const record = () => {
      const ids = impressions.current.filter((id) => !shown.current.has(id));
      if (!ids.length) return;
      ids.forEach((id) => shown.current.add(id));
      update((s) => ({
        ...s,
        impressions: [
          ...(s.impressions ?? []),
          ...ids.map((id) => ({ id, date: new Date().toISOString() })),
        ].slice(-200),
      }));
    };
    const timer = setTimeout(record, 1800);
    return () => clearTimeout(timer);
  }, [results, explore, visibleCount, update]);
  useEffect(() => {
    if (!ready || !query.text) return;
    const town = TOWNS.find(
      (t) => t.name.toLowerCase() === query.text.toLowerCase(),
    );
    if (town) setLocation(town);
  }, [query.text, ready, setLocation]);
  return (
    <div className="discovery-page workspace-page">
      <div className="page-container">
        <section className="workspace-intro">
          <div>
            <h1>Find somewhere worth going.</h1>
            <p>Good ideas near {env.location.name}, shaped around your day.</p>
          </div>
          <div className="workspace-actions">
            <Link className="button secondary" href="/map">
              <MapIcon size={18} /> View map
            </Link>
            <button className="button" onClick={() => setPlan(true)}>
              <Route size={18} /> Plan my day
            </button>
          </div>
        </section>
        <section className="workspace-filters" aria-label="Find outings">
          <form
            className="discovery-search"
            onSubmit={(event) => {
              event.preventDefault();
              document
                .getElementById("your-options")
                ?.scrollIntoView({
                  behavior: env.reducedMotion ? "instant" : "smooth",
                  block: "start",
                });
            }}
          >
            <Search size={19} aria-hidden="true" />
            <input
              aria-label="Find something to do"
              placeholder="Search places or activities"
              value={query.text}
              onChange={(event) =>
                setQuery({ ...query, text: event.target.value })
              }
            />
            <button aria-label="Find outings" type="submit">
              <ArrowRight size={20} />
            </button>
          </form>
          <Refinement />
          {query.intent !== "any" && (
            <div className="active-intent">
              <span>
                Active preference: <strong>{query.intent}</strong>
              </span>
              <button
                type="button"
                onClick={() => setQuery({ ...query, intent: "any" })}
              >
                Clear preference
              </button>
            </div>
          )}
        </section>
        <section className="results-section" id="your-options">
          <div className="section-heading">
            <div>
              <h2>{query.text ? "Search results" : "Places for your day"}</h2>
              <p>
                {results.length} {results.length === 1 ? "idea" : "ideas"} near{" "}
                {env.location.name} · Journey times are estimates
              </p>
            </div>
            <div className="result-actions">
              <button
                className="text-link"
                onClick={() => setSignature("escape")}
              >
                Pick for me
              </button>
              <button
                className="text-link"
                onClick={() => setSignature("surprise")}
              >
                <Shuffle size={17} /> Surprise me
              </button>
            </div>
          </div>
          {query.text && (
            <p className="search-interpretation">
              {nameMatches.length
                ? `Places matching “${query.text}”.`
                : `Ideas for “${query.text}” · ${effective.environment === "any" ? "indoors or outdoors" : effective.environment === "indoor" ? "indoors" : "outdoors"} · based on your preferences.`}
            </p>
          )}
          <div className="discovery-source" role="status">
            <span
              className={`tiny-dot ${placesStatus === "loading" ? "loading-dot" : ""}`}
            />
            {placesMessage || "Curated places while we find more nearby."}
            {placesStatus === "fallback" && (
              <button className="text-link" onClick={refreshPlaces}>
                Try live discovery again
              </button>
            )}
          </div>
          {results.length ? (
            <div className="results-grid">
              {results.slice(0, visibleCount).map((r) => (
                <PlaceCard key={r.place.id} item={r} />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No outings fit these preferences yet."
              text="Try more time, a wider travel range, or another activity."
              action={() => {
                setQuery({
                  ...query,
                  travel: 60,
                  minutes: 240,
                  environment: "any",
                  budget: 80,
                  intent: "any",
                  text: "",
                });
                setCollection("Good right now");
              }}
            />
          )}
          <p className="results-footnote">
            Opening times and admission need checking before you go.
          </p>
          {results.length > visibleCount && (
            <button
              className="button secondary browse-more"
              onClick={() => setVisibleCount((n) => n + 12)}
            >
              Show more ideas <ArrowRight size={17} />
            </button>
          )}
        </section>
      </div>
      {signature && (
        <Signature
          surprise={signature === "surprise"}
          onClose={() => setSignature(null)}
        />
      )}
      {plan && <ItineraryDialog onClose={() => setPlan(false)} />}
    </div>
  );
}
