"use client";
import Link from "next/link";
import {
  Bookmark,
  ArrowUpRight,
  Car,
  Clock,
  Check,
  Footprints,
  X,
  ChevronDown,
} from "lucide-react";
import type { Recommendation } from "@/domain/models";
import { PlaceImage } from "@/components/primitives";
import { useApp } from "@/components/providers";
import { track } from "@/providers/analytics";
import styles from "./place-card.module.css";
export function PlaceCard({
  item,
  compact = false,
}: {
  item: Recommendation;
  compact?: boolean;
}) {
  const { state, update, toast, query } = useApp();
  const p = item.place;
  const saved = state.saved.includes(p.id),
    visited = state.visits.some((v) => v.id === p.id);
  // The ranker owns evidence and semantic-query interpretation. Its first
  // sentence gives the same honest fit on the collapsed and expanded card.
  const matchReason = item.explanation.split(/\.\s+/)[0].replace(/\.$/, "");
  function save() {
    update((s) => ({
      ...s,
      saved: saved ? s.saved.filter((id) => id !== p.id) : [...s.saved, p.id],
    }));
    if (!saved) track("place_saved", { id: p.id });
    toast(
      saved ? "Taken off your list." : "Saved for a day that needs a plan.",
    );
  }
  return (
    <article
      className={`${styles.card} place-card ${compact ? `compact ${styles.compact}` : ""}`}
    >
      <div className="card-visual">
        <Link href={`/place/${p.id}`} aria-label={`See ${p.name}`}>
          <PlaceImage place={p} />
        </Link>
        <button
          className={`save-button ${saved ? "saved" : ""}`}
          onClick={save}
          aria-label={saved ? `Unsave ${p.name}` : `Save ${p.name}`}
          aria-pressed={saved}
        >
          <Bookmark size={18} fill={saved ? "currentColor" : "none"} />
        </button>
        {visited && (
          <span className="visited-badge">
            <Check size={13} /> Been there
          </span>
        )}
      </div>
      <div className="card-content">
        <p className="place-category">
          {p.category} <span>· {p.area.split(",").at(-1)?.trim()}</span>
        </p>
        <Link className="place-title" href={`/place/${p.id}`}>
          <h3>{p.name}</h3>
          <ArrowUpRight size={21} />
        </Link>
        {!compact && (
          <p className={styles.description}>{p.tagline || p.description}</p>
        )}
        <div className="place-meta">
          <span>
            {query.travelMode === "walk" ? (
              <Footprints size={14} />
            ) : (
              <Car size={14} />
            )}
            ~{item.travel} min
          </span>
          <span>{p.cost === 0 ? "Free entry" : p.costLabel}</span>
          <span>
            <Clock size={14} />
            {p.duration[0] === p.duration[1]
              ? p.duration[0]
              : `${p.duration[0]}–${p.duration[1]}`}{" "}
            min
          </span>
        </div>
        {!compact && (
          <details className={styles.reason}>
            <summary>
              <Check size={14} aria-hidden="true" />
              <span>{matchReason}</span>
              <ChevronDown size={13} aria-hidden="true" />
            </summary>
            <p>{item.explanation}</p>
          </details>
        )}
        {!compact &&
          (query.accessNeeds?.wheelchair ||
            query.accessNeeds?.stepFree ||
            query.accessNeeds?.dogs) && (
            <p className="reported-access">
              Access reported · confirm with venue
            </p>
          )}
        <div className="card-bottom">
          <span>
            {p.environment === "mixed"
              ? "Indoors + outdoors"
              : p.environment === "indoor"
                ? "Indoors"
                : "Outdoors"}
          </span>
          <span title={item.opening.label}>
            {item.opening.status === "unknown"
              ? "Check hours"
              : item.opening.label}
          </span>
        </div>
        {!compact && (
          <button
            className="card-dismiss"
            onClick={() => {
              update((s) => ({
                ...s,
                dismissed: [
                  ...s.dismissed,
                  {
                    id: p.id,
                    reason: "Not my thing",
                    date: new Date().toISOString(),
                  },
                ].slice(-500),
              }));
              toast("We’ll leave that one out.");
            }}
            aria-label={`Not interested in ${p.name}`}
          >
            <X size={13} aria-hidden="true" />
            Not for me
          </button>
        )}
      </div>
    </article>
  );
}
