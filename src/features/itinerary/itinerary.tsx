"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  RotateCw,
  Share2,
  Bookmark,
  Clock,
  ArrowUpRight,
  Coffee,
  House,
  MapPin,
  Car,
  Footprints,
  Plus,
  Minus,
} from "lucide-react";
import {
  Modal,
  EmptyState,
  PlaceImage,
  shareUrl,
} from "@/components/primitives";
import { useApp } from "@/components/providers";
import { buildItinerary } from "@/domain/itinerary";
import { effectiveDiscoveryQuery, openingStatus } from "@/domain/discovery";
import { changeCompany } from "@/domain/venue-suitability";
import { formatTime, addMinutes } from "@/domain/time";
import { track } from "@/providers/analytics";
import type { Itinerary, DiscoveryQuery } from "@/domain/models";
import styles from "./itinerary.module.css";

function durationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return [
    hours ? `${hours} hr${hours === 1 ? "" : "s"}` : "",
    remainder ? `${remainder} min` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function ItineraryDialog({
  onClose,
  initial,
}: {
  onClose: () => void;
  initial?: Itinerary;
}) {
  const { places: catalog, env, query, state, update, toast } = useApp();
  const initialFood = initial
    ? initial.stops.some((stop) => stop.type === "break")
    : true;
  const [settings, setSettings] = useState<DiscoveryQuery>(
    () => initial?.query || effectiveDiscoveryQuery(query, catalog),
  );
  const [food, setFood] = useState(initialFood);
  const [skip, setSkip] = useState<string[]>([]);
  const [later, setLater] = useState(0);
  const [addingChild, setAddingChild] = useState(false);
  const plan = useMemo(
    () =>
      initial &&
      skip.length === 0 &&
      later === 0 &&
      settings === initial.query &&
      food === initialFood
        ? initial
        : buildItinerary(
            catalog,
            settings,
            { ...env, location: initial?.origin || env.location },
            state,
            { food, skip, start: addMinutes(initial?.start || env.now, later) },
          ),
    [catalog, env, settings, state, food, skip, later, initial, initialFood],
  );
  const visits = plan?.stops.filter((stop) => stop.type === "place") ?? [];
  const hasBreak = plan?.stops.some((stop) => stop.type === "break");
  const unknownHours = visits.some((stop) => {
    const place = catalog.find((p) => p.id === stop.placeId);
    return !place || openingStatus(place, stop.at).status === "unknown";
  });
  function change(next: Partial<DiscoveryQuery>) {
    setSkip([]);
    setSettings((current) => ({ ...current, ...next }));
  }
  function save() {
    if (!plan) return;
    update((s) => ({
      ...s,
      plans: [plan, ...s.plans.filter((p) => p.id !== plan.id)].slice(0, 30),
    }));
    track("itinerary_generated", { stops: visits.length });
    toast("Day plan saved on this device.");
  }
  function share() {
    if (!plan) return;
    const data = {
      origin: plan.origin,
      start: plan.start,
      query: plan.query,
      food: hasBreak,
      skip,
    };
    shareUrl(
      `${location.origin}/afternoon?plan=${encodeURIComponent(JSON.stringify(data))}`,
      "Your SideQuest day plan",
      toast,
    );
  }
  return (
    <Modal title="Plan my day" onClose={onClose} wide>
      <div className={styles.planner}>
        <header className={styles.header}>
          <h2>Your day, with a direction.</h2>
          <p>A worthwhile visit or two, with time to get there and back.</p>
        </header>
        <div className={styles.controls}>
          <label>
            Time available
            <select
              value={settings.minutes}
              onChange={(e) => change({ minutes: Number(e.target.value) })}
            >
              {[...new Set([120, 180, 240, 300, 360, 480, settings.minutes])]
                .sort((a, b) => a - b)
                .map((v) => (
                  <option key={v} value={v}>
                    {durationLabel(v)}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Who’s coming
            <select
              value={settings.company}
              onChange={(e) => {
                setSkip([]);
                setAddingChild(false);
                setSettings(
                  changeCompany(
                    settings,
                    e.target.value as DiscoveryQuery["company"],
                  ),
                );
              }}
            >
              <option value="solo">Just me</option>
              <option value="couple">Two of us</option>
              <option value="family">With the kids</option>
              <option value="friends">Friends</option>
            </select>
          </label>
          <label>
            Getting around
            <select
              value={settings.travelMode}
              onChange={(e) =>
                change({
                  travelMode: e.target.value as DiscoveryQuery["travelMode"],
                })
              }
            >
              <option value="drive">Driving</option>
              <option value="walk">Walking</option>
            </select>
          </label>
          <label>
            Travel per leg
            <select
              value={settings.travel}
              onChange={(e) => change({ travel: Number(e.target.value) })}
            >
              {[...new Set([15, 30, 45, 60, 90, settings.travel])]
                .sort((a, b) => a - b)
                .map((v) => (
                  <option key={v} value={v}>
                    {v} min max
                  </option>
                ))}
            </select>
          </label>
          <label>
            Admission each
            <select
              value={settings.budget}
              onChange={(e) => change({ budget: Number(e.target.value) })}
            >
              {[...new Set([0, 15, 40, 80, settings.budget])]
                .sort((a, b) => a - b)
                .map((v) => (
                  <option key={v} value={v}>
                    {v === 0 ? "Free entry" : `Up to £${v}`}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Setting
            <select
              value={settings.environment}
              onChange={(e) =>
                change({
                  environment: e.target.value as DiscoveryQuery["environment"],
                })
              }
            >
              <option value="any">Indoors or outdoors</option>
              <option value="indoor">Indoors</option>
              <option value="outdoor">Outdoors</option>
            </select>
          </label>
        </div>
        {settings.company === "family" && (
          <div className={styles.family}>
            <span>Children’s ages</span>
            <div className={styles.childAges}>
              {(settings.childrenAges ?? []).map((age, index) => (
                <div className={styles.childAge} key={index}>
                  <label>
                    Child {index + 1}
                    <select
                      aria-label={`Planner child ${index + 1} age`}
                      value={age}
                      onChange={(e) =>
                        change({
                          childrenAges: settings.childrenAges!.map(
                            (value, childIndex) =>
                              childIndex === index
                                ? Number(e.target.value)
                                : value,
                          ),
                        })
                      }
                    >
                      {Array.from({ length: 18 }, (_, value) => (
                        <option key={value} value={value}>
                          {value === 0
                            ? "Under 1"
                            : `${value} ${value === 1 ? "year" : "years"}`}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    aria-label={`Remove planner child ${index + 1}`}
                    onClick={() =>
                      change({
                        childrenAges: settings.childrenAges!.filter(
                          (_, childIndex) => childIndex !== index,
                        ),
                      })
                    }
                  >
                    <Minus size={15} />
                  </button>
                </div>
              ))}
              {(!settings.childrenAges?.length || addingChild) && (
                <div className={styles.childAge}>
                  <label>
                    Child {(settings.childrenAges?.length ?? 0) + 1}
                    <select
                      aria-label={`Planner child ${(settings.childrenAges?.length ?? 0) + 1} age`}
                      value=""
                      onChange={(e) => {
                        if (!e.target.value) return;
                        change({
                          childrenAges: [
                            ...(settings.childrenAges ?? []),
                            Number(e.target.value),
                          ],
                        });
                        setAddingChild(false);
                      }}
                    >
                      <option value="" disabled>
                        Choose age (optional)
                      </option>
                      {Array.from({ length: 18 }, (_, value) => (
                        <option key={value} value={value}>
                          {value === 0
                            ? "Under 1"
                            : `${value} ${value === 1 ? "year" : "years"}`}
                        </option>
                      ))}
                    </select>
                  </label>
                  {addingChild && (
                    <button
                      type="button"
                      aria-label="Cancel adding planner child"
                      onClick={() => setAddingChild(false)}
                    >
                      <Minus size={15} />
                    </button>
                  )}
                </div>
              )}
              {!!settings.childrenAges?.length &&
                settings.childrenAges.length < 8 &&
                !addingChild && (
                  <button
                    type="button"
                    className={styles.addChild}
                    onClick={() => setAddingChild(true)}
                  >
                    <Plus size={14} />
                    Add child
                  </button>
                )}
            </div>
            <small>
              {settings.childrenAges?.includes(0)
                ? "Infant activity restrictions apply. Check access and facilities with each venue."
                : "Confirm age guidance and any booking requirements before going."}
            </small>
          </div>
        )}
        <div className={styles.start}>
          <span>
            <Clock size={15} /> Leave{" "}
            {initial?.origin.name || env.location.name} at{" "}
            <strong>
              {formatTime(addMinutes(initial?.start || env.now, later))}
            </strong>
          </span>
          <button onClick={() => setLater((s) => s + 30)}>30 min later</button>
          {later > 0 && (
            <button onClick={() => setLater(0)}>Reset start</button>
          )}
        </div>
        {plan ? (
          <>
            <div className={styles.summary} aria-live="polite">
              <span>
                <strong>
                  {visits.length} {visits.length === 1 ? "stop" : "stops"}
                </strong>
                {hasBreak ? " + picnic break" : " · an easy outing"}
              </span>
              <span>
                <strong>{durationLabel(plan.minutes)}</strong> door to door
              </span>
              <span>
                <strong>
                  {plan.unknownCost
                    ? `£${plan.cost}+`
                    : plan.cost === 0
                      ? "Free entry"
                      : `£${plan.cost}`}
                </strong>{" "}
                {plan.unknownCost ? "known admission only" : "admission each"}
              </span>
              <span>
                <strong>~{formatTime(plan.stops.at(-1)!.at)}</strong> back home
              </span>
            </div>
            {food && !hasBreak && (
              <p className={styles.notice}>
                A full 30-minute picnic break doesn’t fit. We’ve kept the visit
                and your return journey.
              </p>
            )}
            <ol className={styles.timeline}>
              {plan.stops.map((stop, i) => {
                const place = stop.placeId
                  ? catalog.find((p) => p.id === stop.placeId)
                  : undefined;
                const Icon =
                  stop.type === "leave"
                    ? settings.travelMode === "walk"
                      ? Footprints
                      : Car
                    : stop.type === "home"
                      ? House
                      : stop.type === "break"
                        ? Coffee
                        : MapPin;
                const previous = plan.stops[i - 1];
                const travel =
                  stop.type === "place" && previous?.type === "place"
                    ? Math.max(
                        0,
                        Math.round(
                          (Date.parse(stop.at) - Date.parse(previous.at)) /
                            60000,
                        ) - previous.minutes,
                      )
                    : 0;
                return (
                  <li
                    key={`${stop.type}-${stop.placeId || i}`}
                    className={
                      stop.type === "place" ? styles.visit : styles.marker
                    }
                  >
                    <time dateTime={stop.at}>{formatTime(stop.at)}</time>
                    <span className={styles.point}>
                      <Icon size={17} />
                    </span>
                    <div className={styles.stop}>
                      {travel > 0 && (
                        <p className={styles.leg}>
                          ~{travel} min{" "}
                          {settings.travelMode === "walk" ? "walk" : "drive"}{" "}
                          from the previous stop
                        </p>
                      )}
                      <div className={styles.stopRow}>
                        {place && (
                          <div className={styles.photo}>
                            <PlaceImage place={place} />
                          </div>
                        )}
                        <div className={styles.stopBody}>
                          <div className={styles.stopTitle}>
                            <h3>{stop.name}</h3>
                            {stop.placeId && (
                              <button
                                className="icon-button"
                                aria-label={`Replace ${stop.name}`}
                                onClick={() =>
                                  setSkip((s) => [...s, stop.placeId!])
                                }
                              >
                                <RotateCw size={16} />
                              </button>
                            )}
                          </div>
                          <p>
                            {stop.type === "leave"
                              ? `~${stop.minutes} min ${settings.travelMode === "walk" ? "walk" : "drive"} to your first stop`
                              : stop.type === "home"
                                ? "Return journey included in your time."
                                : stop.type === "break"
                                  ? `${stop.minutes} min · ${stop.cost ? `£${stop.cost} allowance; not a venue price` : "Bring your own food; no café assumed"}`
                                  : `${stop.minutes} min to explore · ${stop.unknownCost ? "Admission unverified" : place?.costLabel || "Check admission"}`}
                          </p>
                          {place && (
                            <>
                              <p className={styles.evidence}>
                                {openingStatus(place, stop.at).status ===
                                "unknown"
                                  ? "Opening hours unverified — check before travelling"
                                  : `Fits reported hours${place.daylightOnly ? " and daylight" : ""} · confirm before going`}
                              </p>
                              <Link
                                href={`/place/${place.id}`}
                                className={styles.details}
                              >
                                View place <ArrowUpRight size={14} />
                              </Link>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className={styles.adjustments}>
              <button
                onClick={() => {
                  setSkip([]);
                  setFood(!food);
                }}
              >
                {food ? <Minus size={14} /> : <Plus size={14} />}
                {food ? "Remove picnic break" : "Add picnic break"}
              </button>
              <button
                disabled={settings.minutes <= 120}
                onClick={() =>
                  change({ minutes: Math.max(120, settings.minutes - 60) })
                }
              >
                One hour shorter
              </button>
              <button
                disabled={settings.minutes >= 480}
                onClick={() =>
                  change({ minutes: Math.min(480, settings.minutes + 60) })
                }
              >
                Add an hour
              </button>
              <button
                onClick={() =>
                  setSkip((s) => [
                    ...new Set([...s, ...visits.map((stop) => stop.placeId!)]),
                  ])
                }
              >
                <RotateCw size={14} />
                Try another route
              </button>
              {skip.length > 0 && (
                <button onClick={() => setSkip([])}>
                  Reset skipped places ({skip.length})
                </button>
              )}
            </div>
            <div className={styles.footer}>
              <button className="button" onClick={save}>
                <Bookmark size={16} />
                Save day plan
              </button>
              <button className="button secondary" onClick={share}>
                <Share2 size={16} />
                Share plan
              </button>
            </div>
            <p className={styles.finePrint}>
              Journeys and visit lengths are estimates.{" "}
              {unknownHours ? "Some opening hours are unverified. " : ""}
              {plan.unknownCost
                ? "Unknown ticket prices may take this plan over your admission budget. "
                : ""}
              Check hours, admission, booking and access with each venue. Food
              and parking aren’t included.
            </p>
          </>
        ) : (
          <EmptyState
            title={
              skip.length
                ? "You’ve tried the matching places."
                : "No sensible route fits yet."
            }
            text="Keep your company and budget. Try more time, a wider travel range or a different setting."
          >
            <div className={styles.adjustments}>
              {skip.length > 0 && (
                <button className="button" onClick={() => setSkip([])}>
                  Reset skipped places
                </button>
              )}
              <button
                className="button secondary"
                onClick={() =>
                  change({
                    minutes: Math.min(480, settings.minutes + 60),
                    travel: Math.max(settings.travel, 45),
                  })
                }
              >
                Allow more time and travel
              </button>
            </div>
          </EmptyState>
        )}
      </div>
    </Modal>
  );
}
