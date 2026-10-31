"use client";
import {
  SlidersHorizontal,
  Users,
  Clock,
  Car,
  Wallet,
  Footprints,
  X,
  RotateCcw,
} from "lucide-react";
import { useState } from "react";
import { useApp } from "@/components/providers";
import type { DiscoveryQuery, Intent, OptionalCategory } from "@/domain/models";
import { changeActivity, changeCompany } from "@/domain/venue-suitability";
import { DEFAULT_QUERY } from "@/domain/models";
import styles from "./refinement.module.css";
export function Refinement({
  expanded = false,
  mapFood,
}: {
  expanded?: boolean;
  mapFood?: { included: boolean; onChange(value: boolean): void };
}) {
  const { query, setQuery, ready } = useApp();
  const [open, setOpen] = useState(expanded);
  const [addingChild, setAddingChild] = useState(false);
  const ages = query.childrenAges ?? [];
  const set = (patch: Partial<DiscoveryQuery>) =>
    setQuery({ ...query, ...patch });
  const active: { label: string; clear: Partial<DiscoveryQuery> }[] = [];
  if (query.intent !== "any")
    active.push({ label: query.intent, clear: { intent: "any" } });
  if (query.activity && query.activity !== "any")
    active.push({
      label: query.activity.replaceAll("-", " "),
      clear: { activity: "any" },
    });
  if (query.environment !== "any")
    active.push({
      label: query.environment === "indoor" ? "Indoors" : "Outdoors",
      clear: { environment: "any" },
    });
  if (query.budget !== DEFAULT_QUERY.budget)
    active.push({
      label: query.budget === 0 ? "Free entry" : `Up to £${query.budget}`,
      clear: { budget: DEFAULT_QUERY.budget },
    });
  if (query.travelMode === "walk")
    active.push({ label: "Walking", clear: { travelMode: "drive" } });
  for (const interest of query.interests ?? [])
    active.push({
      label:
        (
          {
            culture: "Art & culture",
            unusual: "Something different",
            active: "Get moving",
            scenic: "Beautiful places",
            relax: "Take it slowly",
            walk: "A good walk",
          } as Record<string, string>
        )[interest] ?? interest,
      clear: {
        interests: query.interests?.filter((value) => value !== interest),
      },
    });
  for (const category of query.includeCategories ?? []) {
    if (mapFood && category === "food") continue;
    active.push({
      label: {
        food: "Food & coffee",
        pubs: "Pubs & bars",
        fitness: "Fitness",
        shops: "Shops",
      }[category],
      clear: {
        includeCategories: query.includeCategories?.filter(
          (value) => value !== category,
        ),
      },
    });
  }
  for (const [need, label] of [
    ["wheelchair", "Wheelchair access"],
    ["stepFree", "Step-free access"],
    ["dogs", "Dogs welcome"],
  ] as const) {
    if (query.accessNeeds?.[need])
      active.push({
        label,
        clear: { accessNeeds: { ...query.accessNeeds, [need]: false } },
      });
  }
  if (query.strictSuitability)
    active.push({
      label: "Reported age suitability",
      clear: { strictSuitability: false },
    });
  const activeCount = active.length + (mapFood?.included ? 1 : 0);
  const changed =
    activeCount > 0 ||
    query.company !== DEFAULT_QUERY.company ||
    query.minutes !== DEFAULT_QUERY.minutes ||
    query.travel !== DEFAULT_QUERY.travel ||
    ages.length > 0;
  return (
    <div className={`${styles.refinement} refinement`}>
      <div className="quick-controls">
        <label>
          <Users size={16} />
          <select
            disabled={!ready}
            aria-label="Who is coming"
            value={query.company}
            onChange={(e) =>
              setQuery(
                changeCompany(
                  query,
                  e.target.value as DiscoveryQuery["company"],
                ),
              )
            }
          >
            {[
              ["solo", "Just me"],
              ["couple", "Two of us"],
              ["family", "With the kids"],
              ["friends", "Friends"],
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          <Clock size={16} />
          <select
            disabled={!ready}
            aria-label="Time available"
            value={query.minutes}
            onChange={(e) => set({ minutes: Number(e.target.value) })}
          >
            {[60, 120, 180, 240, 360, 480].map((v) => (
              <option value={v} key={v}>
                {v === 60 ? "An hour" : `${v / 60} hours`}
              </option>
            ))}
          </select>
        </label>
        <label>
          {query.travelMode === "walk" ? (
            <Footprints size={16} />
          ) : (
            <Car size={16} />
          )}
          <select
            disabled={!ready}
            aria-label="Maximum travel time"
            value={query.travel}
            onChange={(e) => set({ travel: Number(e.target.value) })}
          >
            {[15, 30, 45, 60, 90, 120].map((v) => (
              <option value={v} key={v}>
                {v === 90 ? "Worth the drive" : `Within ${v} min`}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={!ready}
          className={open ? "selected" : ""}
          aria-label="More preferences"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <SlidersHorizontal size={16} />
          <span>Preferences{activeCount ? ` (${activeCount})` : ""}</span>
        </button>
      </div>
      <div className="activity-filter">
        <label>
          Type of outing
          <select
            disabled={!ready}
            aria-label="Type of outing"
            value={
              mapFood && query.activity === "food"
                ? "any"
                : (query.activity ?? "any")
            }
            onChange={(event) =>
              setQuery(
                changeActivity(
                  query,
                  event.target.value as NonNullable<DiscoveryQuery["activity"]>,
                ),
              )
            }
          >
            {[
              ["any", "All outings"],
              ["soft-play", "Soft play & play cafés"],
              ["playground", "Playgrounds"],
              ["museum", "Museums & galleries"],
              ["cinema", "Cinema"],
              ["animals", "Animals & aquariums"],
              ["gardens", "Gardens & parks"],
              ["climbing", "Climbing"],
              ["swimming", "Swimming"],
              ["food", "Food & coffee"],
              ["pubs", "Pubs & bars"],
              ["fitness", "Gyms & fitness"],
              ["shops", "Shops"],
              ["walk", "Walks"],
            ]
              .filter(([value]) => !mapFood || value !== "food")
              .map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
          </select>
        </label>
        {mapFood && (
          <label className="map-food-filter">
            <input
              disabled={!ready}
              type="checkbox"
              checked={mapFood.included}
              onChange={(event) => mapFood.onChange(event.target.checked)}
            />
            Include food &amp; coffee
          </label>
        )}
      </div>
      {changed && (
        <div className={styles.activeFilters} aria-label="Active preferences">
          {active.map(({ label, clear }, index) => (
            <button
              key={`${label}-${index}`}
              disabled={!ready}
              onClick={() => set(clear)}
              aria-label={`Remove ${label} preference`}
            >
              {label}
              <X size={13} aria-hidden="true" />
            </button>
          ))}
          {mapFood?.included && (
            <button
              disabled={!ready}
              onClick={() => mapFood.onChange(false)}
              aria-label="Remove food and coffee preference"
            >
              Food &amp; coffee
              <X size={13} aria-hidden="true" />
            </button>
          )}
          <button
            disabled={!ready}
            className={styles.reset}
            onClick={() => {
              setQuery({ ...DEFAULT_QUERY, text: query.text });
              setAddingChild(false);
            }}
          >
            <RotateCcw size={13} aria-hidden="true" /> Reset filters
          </button>
        </div>
      )}
      {query.company === "family" && (
        <fieldset className="family-ages">
          <legend>Children’s ages</legend>
          <p>
            Optional: tailor ideas to your children. Check venue age guidance
            before booking.
          </p>
          {ages.map((age, index) => (
            <div className="child-age-row" key={index}>
              <label>
                Child {index + 1} age
                <select
                  disabled={!ready}
                  aria-label={`Child ${index + 1} age`}
                  value={age}
                  onChange={(event) =>
                    set({
                      childrenAges: ages.map((value, i) =>
                        i === index ? Number(event.target.value) : value,
                      ),
                    })
                  }
                >
                  {Array.from({ length: 18 }, (_, value) => (
                    <option key={value} value={value}>
                      {value === 0 ? "Under 1" : `${value} years`}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={!ready}
                className="button secondary"
                aria-label={`Remove child ${index + 1}`}
                onClick={() =>
                  set({ childrenAges: ages.filter((_, i) => i !== index) })
                }
              >
                Remove
              </button>
            </div>
          ))}
          {(addingChild || ages.length === 0) && ages.length < 8 && (
            <div className="child-age-row">
              <label>
                Child {ages.length + 1} age
                <select
                  disabled={!ready}
                  aria-label={`Child ${ages.length + 1} age`}
                  value=""
                  onChange={(event) => {
                    if (event.target.value !== "") {
                      set({
                        childrenAges: [...ages, Number(event.target.value)],
                      });
                      setAddingChild(false);
                    }
                  }}
                >
                  <option value="">Choose age (optional)</option>
                  {Array.from({ length: 18 }, (_, value) => (
                    <option key={value} value={value}>
                      {value === 0 ? "Under 1" : `${value} years`}
                    </option>
                  ))}
                </select>
              </label>
              {ages.length > 0 && (
                <button
                  disabled={!ready}
                  className="button secondary"
                  onClick={() => setAddingChild(false)}
                >
                  Cancel
                </button>
              )}
            </div>
          )}
          <div className="family-age-actions">
            {ages.length > 0 && ages.length < 8 && !addingChild && (
              <button
                disabled={!ready}
                className="button secondary"
                onClick={() => setAddingChild(true)}
              >
                Add child
              </button>
            )}
          </div>
        </fieldset>
      )}
      {open && (
        <div className="preference-panel">
          <fieldset className="interest-choices">
            <legend>Your kind of afternoon</legend>
            <div>
              {(
                [
                  ["culture", "Art & culture"],
                  ["unusual", "Something different"],
                  ["active", "Get moving"],
                  ["scenic", "Beautiful places"],
                  ["relax", "Take it slowly"],
                  ["walk", "A good walk"],
                ] as [Intent, string][]
              ).map(([interest, label]) => (
                <button
                  disabled={!ready}
                  key={interest}
                  type="button"
                  aria-pressed={query.interests?.includes(interest) ?? false}
                  onClick={() =>
                    set({
                      interests: query.interests?.includes(interest)
                        ? query.interests.filter((v) => v !== interest)
                        : [...(query.interests ?? []), interest],
                    })
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="advanced-controls">
            <label>
              <Wallet size={16} />
              Spend per person
              <select
                disabled={!ready}
                value={query.budget}
                onChange={(e) => set({ budget: Number(e.target.value) })}
              >
                {[0, 15, 40, 80, 200].map((v) => (
                  <option key={v} value={v}>
                    {v === 0
                      ? "Free entry"
                      : v === 200
                        ? "Treat ourselves"
                        : `Up to £${v}`}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Inside or outside?
              <select
                disabled={!ready}
                value={query.environment}
                onChange={(e) =>
                  set({
                    environment: e.target
                      .value as DiscoveryQuery["environment"],
                  })
                }
              >
                <option value="any">Either works</option>
                <option value="indoor">Keep it indoors</option>
                <option value="outdoor">Fresh air please</option>
              </select>
            </label>
            <label>
              <Footprints size={16} />
              Getting there
              <select
                disabled={!ready}
                value={query.travelMode}
                onChange={(e) =>
                  set({
                    travelMode: e.target.value as DiscoveryQuery["travelMode"],
                  })
                }
              >
                <option value="drive">Driving</option>
                <option value="walk">Walking</option>
              </select>
            </label>
          </div>
          <fieldset className="optional-choices">
            <legend>Include everyday places</legend>
            <p>Hidden by default. Add them when they’re part of your plans.</p>
            <div>
              {(
                [
                  ["food", "Food & coffee"],
                  ["pubs", "Pubs & bars"],
                  ["fitness", "Gyms & fitness"],
                  ["shops", "Shops"],
                ] as [OptionalCategory, string][]
              ).map(([category, label]) => (
                <label key={category}>
                  <input
                    disabled={!ready}
                    type="checkbox"
                    checked={
                      query.includeCategories?.includes(category) ?? false
                    }
                    onChange={(e) =>
                      set({
                        includeCategories: e.target.checked
                          ? [
                              ...new Set([
                                ...(query.includeCategories ?? []),
                                category,
                              ]),
                            ]
                          : query.includeCategories?.filter(
                              (v) => v !== category,
                            ),
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="access-choices">
            <legend>Make it work for you</legend>
            <div>
              {(
                [
                  ["wheelchair", "Wheelchair access"],
                  ["stepFree", "Step-free access"],
                  ["dogs", "Dogs welcome"],
                ] as const
              ).map(([need, label]) => (
                <label key={need}>
                  <input
                    disabled={!ready}
                    type="checkbox"
                    checked={query.accessNeeds?.[need] ?? false}
                    onChange={(e) =>
                      set({
                        accessNeeds: {
                          ...query.accessNeeds,
                          [need]: e.target.checked,
                        },
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            <p>
              Required access needs show only places with positive reported
              evidence. Confirm details before travelling.
            </p>
            {query.company === "family" && (
              <label>
                <input
                  disabled={!ready}
                  type="checkbox"
                  checked={query.strictSuitability ?? false}
                  onChange={(e) => set({ strictSuitability: e.target.checked })}
                />
                Only show reported age suitability
              </label>
            )}
          </fieldset>
        </div>
      )}
    </div>
  );
}
