"use client";
import Link from "next/link";
import { useMemo, useState, useEffect } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Shuffle,
  Route,
  Sun,
  CloudRain,
  MapPin,
  Car,
  Clock,
  ChevronRight,
  SlidersHorizontal,
} from "lucide-react";
import { useApp } from "@/components/providers";
import { PlaceImage, EmptyState } from "@/components/primitives";
import { TOWNS } from "@/providers/geocoding";
import { rankPlaces, effectiveDiscoveryQuery } from "@/domain/discovery";
import { contextualHeadline } from "@/domain/environment";
import type { Intent } from "@/domain/models";
import { PlaceCard } from "./place-card";
import { Refinement } from "./refinement";
import { Signature } from "./signature";
import { ItineraryDialog } from "@/features/itinerary/itinerary";
const moods: { label: string; sub: string; intent: Intent; place: string }[] = [
  {
    label: "Somewhere beautiful",
    sub: "A change of scenery",
    intent: "scenic",
    place: "virginia-water",
  },
  {
    label: "Something different",
    sub: "Break the usual routine",
    intent: "unusual",
    place: "watts-gallery",
  },
  {
    label: "A proper little walk",
    sub: "Clear your head",
    intent: "walk",
    place: "swinley-forest",
  },
  {
    label: "Just the two of us",
    sub: "Make some time for each other",
    intent: "date",
    place: "savill",
  },
];
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
  const ranked = useMemo(
    () => rankPlaces(catalog, effective, env, state),
    [catalog, effective, env, state],
  );
  const nameMatches = query.text
    ? ranked.filter((r) =>
        `${r.place.name} ${r.place.area} ${r.place.category}`
          .toLowerCase()
          .includes(query.text.toLowerCase()),
      )
    : [];
  const results = nameMatches.length ? nameMatches : ranked;
  const featured = ranked[0];
  const headline = contextualHeadline(env);
  const wet = env.weather.source !== "unavailable" && env.weather.rain > 0;
  useEffect(() => {
    if (!ready || !query.text) return;
    const town = TOWNS.find(
      (t) => t.name.toLowerCase() === query.text.toLowerCase(),
    );
    if (town) setLocation(town);
  }, [query.text, ready, setLocation]);
  function choose(intent: Intent) {
    setQuery({ ...query, intent });
    setCollection("Good right now");
    document.getElementById("your-options")?.scrollIntoView({
      behavior: env.reducedMotion ? "instant" : "smooth",
      block: "start",
    });
  }
  return (
    <div className="discovery-page">
      <div className="page-container">
        {!explore ? (
          <>
            <section className="home-hero">
              <div className="hero-copy">
                <h1>
                  {headline[0]}
                  <br />
                  <span>{headline[1]}</span>
                </h1>
                <p className="hero-description">
                  A few hours. A little curiosity. <br />
                  We’ll find something actually worth going out for.
                </p>
                <Refinement />
                <button
                  className="button escape-button"
                  onClick={() => setSignature("escape")}
                >
                  Get me out of the house <ArrowUpRight size={22} />
                </button>
                <div className="hero-secondary">
                  <button onClick={() => setSignature("surprise")}>
                    <Shuffle size={17} />
                    Surprise me
                  </button>
                  <span />
                  <button onClick={() => setPlan(true)}>
                    <Route size={18} />
                    Build my afternoon
                  </button>
                </div>
                <p className="hero-footnote">
                  <span className="tiny-dot" /> No big plans required.
                </p>
              </div>
              {featured ? (
                <Link
                  className="hero-pick"
                  href={`/place/${featured.place.id}`}
                >
                  <PlaceImage place={featured.place} priority />
                  <div className="hero-image-shade" />
                  <div className="hero-image-top">
                    <span>
                      <Sun size={15} />A good place to start
                    </span>
                    <span className="hero-match">{featured.score}% match</span>
                  </div>
                  <div className="hero-image-bottom">
                    <p>
                      <MapPin size={14} />
                      {featured.place.area}
                    </p>
                    <h2>{featured.place.name}</h2>
                    <p className="hero-pick-tagline">
                      {featured.place.tagline}
                    </p>
                    <div className="hero-pick-meta">
                      <span>
                        <Car size={15} />~{featured.travel} min
                      </span>
                      <span>
                        {featured.place.cost === 0
                          ? "Free entry"
                          : "Check admission"}
                      </span>
                      <span>
                        <Clock size={15} />
                        {featured.place.duration[0]}+ min
                      </span>
                      <span className="hero-open">
                        <ArrowUpRight size={22} />
                      </span>
                    </div>
                  </div>
                </Link>
              ) : (
                <div className="hero-pick empty-hero">
                  <EmptyState
                    title="A little further might be worth it."
                    text="Nothing suitable within your current limits. Widen your search below."
                    action={() =>
                      setQuery({ ...query, travel: 60, minutes: 240 })
                    }
                  />
                </div>
              )}
            </section>
            <section className="mood-section">
              <div className="section-heading">
                <h2>What’s the mood?</h2>
                <span>Go with your first instinct.</span>
              </div>
              <div className="mood-grid">
                {moods.map((m) => {
                  const p = catalog.find((p) => p.id === m.place)!;
                  return (
                    <button
                      key={m.intent}
                      className={`mood ${query.intent === m.intent ? "active" : ""}`}
                      onClick={() => choose(m.intent)}
                      aria-pressed={query.intent === m.intent}
                    >
                      <PlaceImage place={p} />
                      <span className="mood-shade" />
                      <span className="mood-copy">
                        <strong>{m.label}</strong>
                        <span>{m.sub}</span>
                      </span>
                      <ArrowUpRight size={20} />
                    </button>
                  );
                })}
              </div>
              <button
                className="text-link undecided"
                onClick={() => setSignature("escape")}
              >
                Genuinely don’t know? Pick for me
                <ArrowUpRight size={16} />
              </button>
            </section>
            <div className="weather-note">
              <span className="weather-note-icon">
                {wet ? <CloudRain size={23} /> : <Sun size={23} />}
              </span>
              <div>
                <strong>
                  {env.weather.source === "unavailable"
                    ? "The sky’s a question mark. Your afternoon isn’t."
                    : wet
                      ? "Bit wet. These still work."
                      : "A little fresh air goes a long way."}
                </strong>
                <span>
                  {env.weather.source === "unavailable"
                    ? "We’ll keep finding good options. Check the forecast before you head out."
                    : wet
                      ? "Sheltered ideas move up the list. The forecast does some of the thinking."
                      : `Ideas shaped around ${env.location.name}, your time, and the conditions.`}
                </span>
              </div>
              <Link href="/map">
                See what’s nearby
                <ArrowRight size={18} />
              </Link>
            </div>
          </>
        ) : (
          <section className="explore-heading">
            <h1>
              There’s more
              <br />
              <span>around the corner.</span>
            </h1>
            <p>Good places. A little context. Find your kind of detour.</p>
            <form
              className="explore-search"
              onSubmit={(e) => {
                e.preventDefault();
              }}
            >
              <input
                aria-label="Search places, town or intent"
                placeholder="A place, a town, or a little inspiration…"
                value={query.text}
                onChange={(e) => setQuery({ ...query, text: e.target.value })}
              />
              <SlidersHorizontal size={20} />
            </form>
            <Refinement />
            <div className="collection-tabs" aria-label="Editorial collections">
              {[
                "Good right now",
                "Hidden nearby",
                "Actually free",
                "Rain won’t ruin these",
                "Worth the drive",
              ].map((c) => (
                <button
                  key={c}
                  onClick={() => setCollection(c)}
                  aria-pressed={collection === c}
                  className={collection === c ? "active" : ""}
                >
                  {c}
                </button>
              ))}
            </div>
          </section>
        )}
        <section className="results-section" id="your-options">
          {query.text && (
            <p className="search-interpretation">
              {nameMatches.length
                ? `Places matching “${query.text}”.`
                : `Ideas for “${query.text}” · ${effective.environment === "any" ? "indoors or outdoors" : effective.environment} · ${effective.minutes / 60} hours · within ${effective.travel} min. Familiar phrases set simple filters; unrecognised words keep your current preferences.`}
            </p>
          )}
          <div className="section-heading">
            <div>
              <h2>
                {explore
                  ? collection
                  : query.intent === "any"
                    ? "Your next good idea"
                    : `A few ${query.intent === "walk" ? "walks" : query.intent === "scenic" ? "beautiful places" : "good ideas"} worth going out for`}
              </h2>
              <p>
                {results.length
                  ? explore
                    ? `${results.length} ideas that fit your preferences.`
                    : "A few strong ideas. Browse more whenever you like."
                  : "Your preferences are doing the filtering."}
              </p>
            </div>
            <Link href="/map" className="text-link">
              Put them on the map
              <ArrowUpRight size={17} />
            </Link>
          </div>
          {query.intent !== "any" && !explore && (
            <button
              className="clear-mood"
              onClick={() => setQuery({ ...query, intent: "any" })}
            >
              Clear mood: {query.intent} ×
            </button>
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
              {results.slice(0, explore ? visibleCount : 3).map((r) => (
                <PlaceCard key={r.place.id} item={r} />
              ))}
            </div>
          ) : (
            <EmptyState
              title={
                env.failures.includes("places")
                  ? "Places are taking a breather."
                  : "Nothing brilliant within these limits."
              }
              text={
                env.failures.includes("places")
                  ? "Your saved places are still available. Reset the simulated failure in the Environment Lab."
                  : "Try a little longer, a little further, or a different mood."
              }
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
            ~ Journey times are estimates · Opening times and admission need
            checking
          </p>
          {results.length > (explore ? visibleCount : 3) &&
            (explore ? (
              <button
                className="button secondary browse-more"
                onClick={() => setVisibleCount((n) => n + 12)}
              >
                Show 12 more ideas <ArrowRight size={17} />
              </button>
            ) : (
              <Link className="text-link browse-more" href="/explore">
                Browse all {results.length} ideas <ArrowRight size={17} />
              </Link>
            ))}
        </section>
        <section className="plan-strip">
          <div>
            <Route size={30} strokeWidth={1.5} />
            <h2>
              A little plan.
              <br />A much better afternoon.
            </h2>
          </div>
          <p>
            A good first stop, a bit of breathing room,
            <br />
            and a sensible time to be back.
          </p>
          <button className="button" onClick={() => setPlan(true)}>
            Build my afternoon
            <ChevronRight size={18} />
          </button>
        </section>
      </div>
      {signature && (
        <Signature
          surprise={signature === "surprise"}
          onClose={() => setSignature(null)}
        />
      )}{" "}
      {plan && <ItineraryDialog onClose={() => setPlan(false)} />}
    </div>
  );
}
