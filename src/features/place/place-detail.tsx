"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  ArrowLeft,
  Bookmark,
  Share2,
  Car,
  Clock,
  MapPin,
  Sun,
  Accessibility,
  Footprints,
  X,
  Check,
  ExternalLink,
} from "lucide-react";
import { PlaceImage, Modal, shareUrl } from "@/components/primitives";
import { useApp } from "@/components/providers";
import { PLACES } from "@/providers/places";
import { rankPlaces, openingStatus } from "@/domain/discovery";
import { estimatedRouting, directionsUrl } from "@/providers/routing";
import { durationLabel, addMinutes, formatTime } from "@/domain/time";
import { PlaceCard } from "@/features/discover/place-card";
import { track } from "@/providers/analytics";
import type { Place, Reaction } from "@/domain/models";
export function PlaceDetail({ place }: { place: Place }) {
  const { env, query, state, update, toast } = useApp();
  const [visit, setVisit] = useState(false),
    [dismiss, setDismiss] = useState(false);
  const saved = state.saved.includes(place.id);
  const ranking = rankPlaces(PLACES, query, env, state),
    item = ranking.find((r) => r.place.id === place.id);
  const route = estimatedRouting.estimate(
    env.location,
    place.coordinates,
    query.travelMode,
  );
  const opening = openingStatus(place, addMinutes(env.now, route.minutes));
  const visits = state.visits.filter((v) => v.id === place.id);
  useEffect(() => {
    track("recommendation_viewed", { id: place.id });
    update((s) => ({
      ...s,
      recent: [place.id, ...s.recent.filter((id) => id !== place.id)].slice(
        0,
        30,
      ),
    }));
  }, [place.id, update]);
  function save() {
    update((s) => ({
      ...s,
      saved: saved
        ? s.saved.filter((id) => id !== place.id)
        : [...s.saved, place.id],
    }));
    toast(saved ? "Taken off your list." : "Saved for another good day.");
    if (!saved) track("place_saved", { id: place.id });
  }
  return (
    <div className="detail-page">
      <div className="page-container">
        <Link className="back-link" href="/">
          <ArrowLeft size={17} />
          Back to good ideas
        </Link>
        <div className="detail-hero">
          <PlaceImage place={place} priority />
          <div className="detail-image-label">
            <span>{place.category}</span>
            <span>{place.area}</span>
          </div>
        </div>
        <div className="detail-layout">
          <article>
            <div className="detail-title-row">
              <h1>{place.name}</h1>
              {item && (
                <span className="detail-match">
                  {item.score}%<small>SideQuest match</small>
                </span>
              )}
            </div>
            <p className="detail-tagline">{place.tagline}</p>
            <div className="detail-facts">
              <span>
                <Car size={17} />~{route.minutes} min{" "}
                {query.travelMode === "walk" ? "walk" : "drive"}
              </span>
              <span>
                <Clock size={17} />
                {durationLabel(place.duration[0])}–
                {durationLabel(place.duration[1])}
              </span>
              <span>{place.costLabel}</span>
              <span>
                <Sun size={17} />
                {place.environment === "mixed"
                  ? "Indoors + outdoors"
                  : place.environment}
              </span>
            </div>
            <section className="detail-section">
              <h2>Why SideQuest picked this</h2>
              <p>
                {item
                  ? item.explanation
                  : "This place does not currently fit all your preferences or the conditions. It is still here to explore and save for another day."}
              </p>
              {item && (
                <ul className="why-list">
                  {item.reasons.map((reason) => (
                    <li key={reason}>
                      <Check size={16} />
                      {reason}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="detail-section">
              <h2>Good to know</h2>
              <ul className="practical-list">
                {place.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
              <div className="access-note">
                <Accessibility size={23} />
                <div>
                  <strong>Make it work for you.</strong>
                  <p>
                    Step-free access, facilities and parking have not been
                    verified. Check the venue’s access information before
                    setting out.
                  </p>
                </div>
              </div>
              <a
                className="text-link"
                href={place.website}
                target="_blank"
                rel="noreferrer"
              >
                Official website
                <ExternalLink size={16} />
              </a>
            </section>
            <section className="detail-section">
              <h2>A little perspective</h2>
              <div className="detail-location">
                <MapPin size={26} />
                <div>
                  <strong>{place.area}</strong>
                  <p>
                    {place.coordinates.lat.toFixed(4)}° N ·{" "}
                    {Math.abs(place.coordinates.lng).toFixed(4)}° W
                  </p>
                </div>
                <Link
                  className="button secondary"
                  href={`/map?place=${place.id}`}
                >
                  Open map
                  <ArrowUpRight size={17} />
                </Link>
              </div>
            </section>
            {visits.length > 0 && (
              <section className="detail-section">
                <h2>Your last visit</h2>
                <strong>{visits[0].reaction}</strong>
                <p>{visits[0].note || "A little memory of somewhere good."}</p>
                <small>
                  {new Date(visits[0].date).toLocaleDateString("en-GB", {
                    timeZone: "Europe/London",
                  })}
                </small>
              </section>
            )}
            {place.image && (
              <p className="image-credit">
                Photo:{" "}
                <a href={place.image.source} target="_blank" rel="noreferrer">
                  {place.image.credit} · {place.image.license}
                </a>
                . Cropped for display.{" "}
                {place.image.license.startsWith("CC BY") && (
                  <a
                    href={`https://creativecommons.org/licenses/${place.image.license.includes("SA") ? "by-sa" : "by"}/${place.image.license.includes("3.0") ? "3.0" : "2.0"}/`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Licence
                  </a>
                )}
              </p>
            )}
          </article>
          <aside className="detail-action-panel">
            <h2>
              Go somewhere.
              <br />
              Feel a little different.
            </h2>
            <p>
              <Clock size={16} />
              {opening.label}
            </p>
            <p>
              Allow about {durationLabel(route.minutes * 2 + place.duration[0])}{" "}
              door to door. Back around{" "}
              {formatTime(
                addMinutes(env.now, route.minutes * 2 + place.duration[0]),
              )}{" "}
              if you leave now.
            </p>
            <a
              className="button full"
              href={directionsUrl(place.coordinates)}
              target="_blank"
              rel="noreferrer"
              onClick={() => track("directions_opened", { id: place.id })}
            >
              Let’s go
              <ArrowUpRight size={20} />
            </a>
            <a
              className="apple-directions"
              href={directionsUrl(place.coordinates, "apple")}
              target="_blank"
              rel="noreferrer"
            >
              Or open in Apple Maps
            </a>
            <button
              className="button secondary full"
              onClick={save}
              aria-pressed={saved}
            >
              <Bookmark size={17} fill={saved ? "currentColor" : "none"} />
              {saved ? "Saved for later" : "Save for later"}
            </button>
            <div className="detail-small-actions">
              <button onClick={() => setVisit(true)}>
                <Footprints size={17} />
                Been here
              </button>
              <button
                onClick={() =>
                  shareUrl(
                    `${location.origin}/place/${place.id}`,
                    `Fancy ${place.name}?`,
                    toast,
                  )
                }
              >
                <Share2 size={17} />
                Share
              </button>
            </div>
            {saved && (
              <label className="collection-select">
                Add to a collection
                <select
                  defaultValue=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    update((s) => ({
                      ...s,
                      collections: s.collections.map((c) =>
                        c.id === e.target.value
                          ? {
                              ...c,
                              places: [...new Set([...c.places, place.id])],
                            }
                          : c,
                      ),
                    }));
                    toast("Added to your collection.");
                  }}
                >
                  <option value="">Choose a collection</option>
                  {state.collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button className="dismiss-link" onClick={() => setDismiss(true)}>
              Not for me
            </button>
            <p className="fine-print">
              Estimated journey. Check the official site for opening times,
              tickets and practical details.
            </p>
          </aside>
        </div>
        <section className="alternatives">
          <div className="section-heading">
            <h2>Another direction, perhaps?</h2>
            <Link href="/explore">
              Explore more
              <ArrowUpRight size={17} />
            </Link>
          </div>
          <div className="results-grid">
            {ranking
              .filter((r) => r.place.id !== place.id)
              .slice(0, 3)
              .map((r) => (
                <PlaceCard key={r.place.id} item={r} />
              ))}
          </div>
        </section>
      </div>
      <div className="mobile-go">
        <button
          className="icon-button"
          onClick={save}
          aria-label={saved ? "Unsave place" : "Save place"}
        >
          <Bookmark size={20} fill={saved ? "currentColor" : "none"} />
        </button>
        <a
          className="button"
          href={directionsUrl(place.coordinates)}
          target="_blank"
          rel="noreferrer"
        >
          Let’s go <ArrowUpRight size={20} />
        </a>
      </div>
      {visit && (
        <VisitDialog
          place={place}
          km={route.km}
          onClose={() => setVisit(false)}
        />
      )}{" "}
      {dismiss && (
        <Modal
          title="Not your kind of thing?"
          onClose={() => setDismiss(false)}
        >
          <p className="dialog-intro">
            No problem. A reason helps us make the next idea better.
          </p>
          <div className="reaction-grid">
            {[
              "Already been",
              "Too far",
              "Too expensive",
              "Not today",
              "Not my thing",
              "Skip without a reason",
            ].map((reason) => (
              <button
                key={reason}
                className="button secondary"
                onClick={() => {
                  update((s) => ({
                    ...s,
                    dismissed: [
                      ...s.dismissed,
                      { id: place.id, reason, date: env.now },
                    ],
                  }));
                  track("recommendation_dismissed", { id: place.id, reason });
                  toast(
                    reason === "Not my thing"
                      ? "We’ll skip this place in your recommendations."
                      : "We’ll give this place a break for today.",
                  );
                  setDismiss(false);
                }}
              >
                {reason}
                <X size={15} />
              </button>
            ))}
          </div>
          <p className="fine-print">
            “Not today” expires after a day. “Not my thing” keeps this place out
            until you reset it in Been there.
          </p>
        </Modal>
      )}
    </div>
  );
}
function VisitDialog({
  place,
  km,
  onClose,
}: {
  place: Place;
  km: number;
  onClose: () => void;
}) {
  const { env, update, toast } = useApp();
  const [reaction, setReaction] = useState<Reaction>("Good"),
    [note, setNote] = useState("");
  return (
    <Modal title={`How was ${place.name}?`} onClose={onClose}>
      <p className="dialog-intro">
        A quick thought now makes the next SideQuest better.
      </p>
      <div className="reaction-grid">
        {(["Loved it", "Good", "Meh", "Not again"] as Reaction[]).map((r) => (
          <button
            key={r}
            className={`button secondary ${reaction === r ? "selected" : ""}`}
            aria-pressed={reaction === r}
            onClick={() => setReaction(r)}
          >
            {r}
          </button>
        ))}
      </div>
      <label className="field-label">
        A note for future you (optional)
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="Worth the detour? Anything to remember?"
        />
      </label>
      <button
        className="button full"
        onClick={() => {
          update((s) => ({
            ...s,
            visits: [
              { id: place.id, date: env.now, reaction, note, km },
              ...s.visits,
            ].slice(0, 500),
          }));
          toast("A little memory, saved.");
          onClose();
        }}
      >
        Save my visit
        <Check size={18} />
      </button>
    </Modal>
  );
}
