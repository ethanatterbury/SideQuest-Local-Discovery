"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Route,
  RotateCw,
  Share2,
  Bookmark,
  Clock,
  ArrowUpRight,
  Coffee,
  House,
  MapPin,
  Car,
  Plus,
  Minus,
} from "lucide-react";
import { Modal, EmptyState, shareUrl } from "@/components/primitives";
import { useApp } from "@/components/providers";
import { buildItinerary } from "@/domain/itinerary";
import { formatTime, addMinutes, durationLabel } from "@/domain/time";
import { track } from "@/providers/analytics";
import type { Itinerary, DiscoveryQuery } from "@/domain/models";
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
      initial?.query || query,
    ),
    [food, setFood] = useState(initialFood),
    [skip, setSkip] = useState<string[]>([]),
    [later, setLater] = useState(0);
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
            {
              food,
              skip,
              start: addMinutes(initial?.start || env.now, later),
            },
          ),
    [catalog, env, settings, state, food, skip, later, initial, initialFood],
  );
  function save() {
    if (!plan) return;
    update((s) => ({
      ...s,
      plans: [plan, ...s.plans.filter((p) => p.id !== plan.id)].slice(0, 30),
    }));
    track("itinerary_generated", { stops: plan.stops.length });
    toast("Afternoon saved on this device.");
  }
  function share() {
    if (!plan) return;
    const data = {
      origin: plan.origin,
      start: plan.start,
      query: plan.query,
      food: plan.stops.some((stop) => stop.type === "break"),
      skip,
    };
    shareUrl(
      `${location.origin}/afternoon?plan=${encodeURIComponent(JSON.stringify(data))}`,
      "Fancy a little SideQuest?",
      toast,
    );
  }
  return (
    <Modal title="Build my afternoon" onClose={onClose} wide>
      <div className="itinerary-header">
        <Route size={28} />
        <h2>
          A little plan.
          <br />
          <span>No overthinking.</span>
        </h2>
        <p>Built around your time, your starting point, and what’s nearby.</p>
      </div>
      <div className="itinerary-controls">
        <label>
          Time
          <select
            value={settings.minutes}
            onChange={(e) =>
              setSettings({ ...settings, minutes: Number(e.target.value) })
            }
          >
            {[120, 180, 240, 300, 360, 480].map((v) => (
              <option key={v} value={v}>
                {v / 60} hours
              </option>
            ))}
          </select>
        </label>
        <label>
          Company
          <select
            value={settings.company}
            onChange={(e) =>
              setSettings({
                ...settings,
                company: e.target.value as DiscoveryQuery["company"],
              })
            }
          >
            <option value="solo">Just me</option>
            <option value="couple">Two of us</option>
            <option value="family">With the kids</option>
            <option value="friends">Friends</option>
          </select>
        </label>
        <label>
          Travel
          <select
            value={settings.travel}
            onChange={(e) =>
              setSettings({ ...settings, travel: Number(e.target.value) })
            }
          >
            {[15, 30, 45, 60, 90].map((v) => (
              <option key={v} value={v}>
                {v} min max
              </option>
            ))}
          </select>
        </label>
        <label>
          Budget each
          <select
            value={settings.budget}
            onChange={(e) =>
              setSettings({ ...settings, budget: Number(e.target.value) })
            }
          >
            {[0, 15, 40, 80].map((v) => (
              <option key={v} value={v}>
                {v === 0 ? "Free" : `£${v}`}
              </option>
            ))}
          </select>
        </label>
      </div>
      {plan ? (
        <>
          <div className="itinerary-summary">
            <span>
              <Clock size={16} />
              {durationLabel(plan.minutes)} door to door
            </span>
            <span>
              {plan.unknownCost
                ? "Admission unverified"
                : `£${plan.cost} planned per person`}
            </span>
            <span>Back ~{formatTime(plan.stops.at(-1)!.at)}</span>
          </div>
          <ol className="timeline">
            {plan.stops.map((stop, i) => {
              const Icon =
                stop.type === "leave"
                  ? Car
                  : stop.type === "home"
                    ? House
                    : stop.type === "break"
                      ? Coffee
                      : MapPin;
              return (
                <li key={`${stop.type}-${i}`}>
                  <time>{formatTime(stop.at)}</time>
                  <div className="timeline-point">
                    <Icon size={17} />
                  </div>
                  <div className="timeline-content">
                    <div>
                      <h3>{stop.name}</h3>
                      {stop.placeId && (
                        <button
                          className="icon-button"
                          aria-label={`Regenerate ${stop.name}`}
                          onClick={() => setSkip((s) => [...s, stop.placeId!])}
                        >
                          <RotateCw size={16} />
                        </button>
                      )}
                    </div>
                    <p>
                      {stop.type === "leave"
                        ? "Journey estimates include a little breathing room."
                        : stop.type === "home"
                          ? "With the rest of the day still yours."
                          : stop.type === "break"
                            ? `A ${stop.minutes} min break. ${stop.cost ? `£${stop.cost} allowance, not a quoted venue price.` : "Bring your own food."}`
                            : `${stop.minutes} min to explore · ${catalog.find((p) => p.id === stop.placeId)?.costLabel}`}
                    </p>
                    {stop.placeId && (
                      <Link
                        href={`/place/${stop.placeId}`}
                        className="text-link"
                      >
                        Meet this place <ArrowUpRight size={14} />
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="plan-adjustments">
            <button
              onClick={() => {
                setSkip([]);
                setFood(!food);
              }}
            >
              {food ? <Minus size={15} /> : <Plus size={15} />}{" "}
              {food ? "Remove food break" : "Add food break"}
            </button>
            <button
              onClick={() => {
                setSkip([]);
                setSettings({
                  ...settings,
                  budget: Math.max(0, settings.budget - 15),
                });
              }}
            >
              Make it cheaper
            </button>
            <button
              onClick={() => {
                setSkip([]);
                setSettings({
                  ...settings,
                  minutes: Math.max(120, settings.minutes - 60),
                });
              }}
            >
              Make it shorter
            </button>
            <button
              onClick={() => {
                setSkip([]);
                setSettings({
                  ...settings,
                  mode: settings.mode === "surprise" ? "normal" : "surprise",
                });
              }}
            >
              {settings.mode === "surprise"
                ? "Keep it familiar"
                : "More adventurous"}
            </button>
            <button onClick={() => setLater((s) => s + 30)}>
              Start 30 min later
            </button>
            <button
              onClick={() =>
                setSettings({
                  ...settings,
                  minutes: Math.min(480, settings.minutes + 60),
                })
              }
            >
              Add an hour
            </button>
          </div>
          <div className="itinerary-footer">
            <button className="button" onClick={save}>
              <Bookmark size={17} />
              Save this afternoon
            </button>
            <button className="button secondary" onClick={share}>
              <Share2 size={17} />
              Share
            </button>
          </div>
          <p className="fine-print">
            All journeys are estimates. A food break is a time and budget
            allowance, not a reservation.{" "}
            {plan.unknownCost
              ? "One or more ticket prices are unknown; this plan cannot guarantee your budget."
              : ""}{" "}
            Check venue hours and access before going.
          </p>
        </>
      ) : (
        <EmptyState
          title="These plans need a little more room."
          text="Try more time, a wider travel range, or an indoor option. No sensible itinerary fits these constraints."
        >
          <button
            className="button"
            onClick={() => {
              setSkip([]);
              setSettings({
                ...settings,
                travel: 60,
                minutes: 240,
                environment: "any",
                budget: 80,
              });
            }}
          >
            Give it a little more room
          </button>
        </EmptyState>
      )}
    </Modal>
  );
}
