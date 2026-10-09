"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  RotateCw,
  Bookmark,
  Car,
  Clock,
  MapPin,
  Sparkles,
} from "lucide-react";
import { Modal, PlaceImage, EmptyState } from "@/components/primitives";
import { useApp } from "@/components/providers";
import { effectiveDiscoveryQuery, rankPlaces } from "@/domain/discovery";
import { track } from "@/providers/analytics";
export function Signature({
  surprise,
  onClose,
}: {
  surprise: boolean;
  onClose: () => void;
}) {
  const { places: catalog, env, query, state, update, toast } = useApp();
  const [rolled, setRolled] = useState<string[]>([]),
    [revealing, setRevealing] = useState(true);
  const options = rankPlaces(
    catalog,
    {
      ...effectiveDiscoveryQuery(query, catalog),
      mode: surprise ? "surprise" : "normal",
    },
    env,
    state,
  );
  const item = options.find((r) => !rolled.includes(r.place.id));
  useEffect(() => {
    const t = setTimeout(
      () => setRevealing(false),
      env.reducedMotion ? 0 : 500,
    );
    return () => clearTimeout(t);
  }, [rolled, env.reducedMotion]);
  function roll() {
    if (item) {
      setRolled((s) => [...s, item.place.id]);
      setRevealing(true);
    }
  }
  useEffect(() => {
    track("discovery_started", { mode: surprise ? "surprise" : "escape" });
  }, [surprise]);
  return (
    <Modal
      title={surprise ? "A little out of the ordinary" : "Your SideQuest"}
      onClose={onClose}
      wide
    >
      {item ? (
        <div className={`signature-result ${revealing ? "revealing" : ""}`}>
          <div className="signature-visual">
            <PlaceImage place={item.place} priority />
            <span className="match-badge">
              <Sparkles size={13} />
              {item.score}% SideQuest match
            </span>
          </div>
          <div className="signature-body">
            <span className="place-category">{item.place.category}</span>
            <h2>{item.place.name}</h2>
            <p>{item.explanation}</p>
            <ul className="fine-print">
              {item.reasons.slice(3).map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <div className="signature-facts">
              <span>
                <Car size={17} />~{item.travel} min journey
              </span>
              <span>
                <Clock size={17} />
                {item.place.duration[0]}–{item.place.duration[1]} min
              </span>
              <span>
                <MapPin size={17} />
                {item.place.area}
              </span>
              <span>{item.place.costLabel}</span>
            </div>
            <div className="signature-actions">
              <Link
                className="button"
                href={`/place/${item.place.id}`}
                onClick={() =>
                  track("sidequest_started", { id: item.place.id })
                }
              >
                Let’s go <ArrowUpRight size={20} />
              </Link>
              <button className="button secondary" onClick={roll}>
                <RotateCw size={17} />
                Roll another
              </button>
              <button
                className="icon-button"
                aria-label="Save this SideQuest"
                onClick={() => {
                  update((s) => ({
                    ...s,
                    saved: [...new Set([...s.saved, item.place.id])],
                    recent: [
                      item.place.id,
                      ...s.recent.filter((id) => id !== item.place.id),
                    ].slice(0, 30),
                  }));
                  toast("SideQuest saved.");
                }}
              >
                <Bookmark size={20} />
              </button>
            </div>
            <p className="fine-print">
              Journey times are estimates. {item.opening.label} before leaving.
            </p>
          </div>
        </div>
      ) : (
        <EmptyState
          title="Nothing brilliant fits just now."
          text="Try more time or a wider travel range. A good decision is worth being honest about."
        >
          <button
            className="button"
            onClick={() => {
              setRolled([]);
              if (!options.length) onClose();
            }}
          >
            {options.length ? "Revisit these ideas" : "Adjust my preferences"}
          </button>
        </EmptyState>
      )}
    </Modal>
  );
}
