"use client";
import Link from "next/link";
import { useState } from "react";
import {
  Bookmark,
  ArrowUpRight,
  Plus,
  Footprints,
  Route,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { useApp } from "@/components/providers";
import { EmptyState, PlaceImage, Modal } from "@/components/primitives";
import { ItineraryDialog } from "@/features/itinerary/itinerary";
import type { Itinerary } from "@/domain/models";
export function Library({ history = false }: { history?: boolean }) {
  const { places: catalog, state, update, toast } = useApp();
  const [collection, setCollection] = useState("all"),
    [creating, setCreating] = useState(false),
    [name, setName] = useState(""),
    [plan, setPlan] = useState<Itinerary | null>(null);
  const ids = history
    ? [...new Set(state.visits.map((v) => v.id))]
    : collection === "all"
      ? state.saved
      : state.collections.find((c) => c.id === collection)?.places || [];
  const places = ids
    .map((id) => catalog.find((p) => p.id === id))
    .filter((p) => !!p);
  const visits = state.visits;
  const miles = Math.round(
    visits.reduce((sum, v) => sum + v.km * 2, 0) * 0.621371,
  );
  return (
    <div className="page-container library-page">
      <div className="library-heading">
        <div>
          {history ? <Footprints size={24} /> : <Bookmark size={24} />}
          <h1>
            {history ? (
              <>
                A little more
                <br />
                <span>of the world.</span>
              </>
            ) : (
              <>
                Good ideas.
                <br />
                <span>For another day.</span>
              </>
            )}
          </h1>
          <p>
            {history
              ? "Places you’ve actually gone. Tiny escapes that add up."
              : "The next time you don’t know what to do, start here."}
          </p>
        </div>
        <span className="library-note">
          Yours. On this device.
          <br />
          No account needed.
        </span>
      </div>
      {history && visits.length > 0 && (
        <div className="history-stats">
          <div>
            <strong>{places.length}</strong>
            <span>places explored</span>
          </div>
          <div>
            <strong>~{miles}</strong>
            <span>estimated return miles</span>
          </div>
          <div>
            <strong>
              {visits.filter((v) => v.reaction === "Loved it").length}
            </strong>
            <span>worth going back for</span>
          </div>
        </div>
      )}
      {!history && (
        <>
          <div className="collection-tabs">
            <button
              className={collection === "all" ? "active" : ""}
              onClick={() => setCollection("all")}
            >
              Everything saved<span>{state.saved.length}</span>
            </button>
            {state.collections.map((c) => (
              <button
                key={c.id}
                className={collection === c.id ? "active" : ""}
                onClick={() => setCollection(c.id)}
              >
                {c.name}
                <span>{c.places.length}</span>
              </button>
            ))}
            <button onClick={() => setCreating(true)}>
              <Plus size={16} />
              New collection
            </button>
          </div>
          {collection !== "all" && (
            <div className="collection-management">
              <p>Add places here from their detail page. </p>
              {!collection.startsWith("collection-") && (
                <button
                  className="text-link"
                  onClick={() => {
                    update((s) => ({
                      ...s,
                      collections: s.collections.filter(
                        (c) => c.id !== collection,
                      ),
                    }));
                    setCollection("all");
                    toast("Collection removed. Saved places kept.");
                  }}
                >
                  <Trash2 size={15} />
                  Remove collection
                </button>
              )}
            </div>
          )}
        </>
      )}
      {places.length ? (
        <div className="library-grid">
          {places.map((p) => {
            const v = visits.find((v) => v.id === p.id);
            return (
              <article className="saved-place" key={p.id}>
                <Link href={`/place/${p.id}`}>
                  <PlaceImage place={p} />
                </Link>
                <div>
                  <p className="place-category">{p.category}</p>
                  <Link className="place-title" href={`/place/${p.id}`}>
                    <h2>{p.name}</h2>
                    <ArrowUpRight size={20} />
                  </Link>
                  <p>{history ? v?.note || p.tagline : p.tagline}</p>
                  {history && v ? (
                    <div className="visit-label">
                      <span>{v.reaction}</span>
                      <span>
                        {new Date(v.date).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                          timeZone: "Europe/London",
                        })}
                      </span>
                    </div>
                  ) : (
                    <button
                      className="text-link"
                      onClick={() => {
                        update((s) => ({
                          ...s,
                          saved: s.saved.filter((id) => id !== p.id),
                          collections: s.collections.map((c) => ({
                            ...c,
                            places: c.places.filter((id) => id !== p.id),
                          })),
                        }));
                        toast("Taken off your list.");
                      }}
                    >
                      Remove from saved
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title={
            history
              ? "The good bits are still ahead."
              : collection === "all"
                ? "A good idea is worth keeping."
                : "Give this collection a first good idea."
          }
          text={
            history
              ? "After a SideQuest, tap “Been here” on its place page. Your little exploration history starts there."
              : "Tap the bookmark on any place. When the day needs a plan, you’ll have one."
          }
        >
          <Link className="button" href="/">
            Find a little SideQuest
            <ArrowUpRight size={18} />
          </Link>
        </EmptyState>
      )}
      {!history && state.plans.length > 0 && (
        <section className="saved-plans">
          <h2>Afternoons in your pocket.</h2>
          {state.plans.map((p) => (
            <div key={p.id}>
              <Route size={24} />
              <button onClick={() => setPlan(p)}>
                <strong>
                  {p.stops.find((s) => s.type === "place")?.name ||
                    "Your afternoon"}
                </strong>
                <span>
                  {p.minutes} min · {p.origin.name} · Saved{" "}
                  {new Date(p.created).toLocaleDateString("en-GB")}
                </span>
              </button>
              <button
                className="icon-button"
                aria-label="Delete saved afternoon"
                onClick={() =>
                  update((s) => ({
                    ...s,
                    plans: s.plans.filter((plan) => plan.id !== p.id),
                  }))
                }
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </section>
      )}
      {history && state.dismissed.length > 0 && (
        <div className="history-reset">
          <p>{state.dismissed.length} places given a break.</p>
          <button
            className="text-link"
            onClick={() => {
              update((s) => ({ ...s, dismissed: [] }));
              toast("Dismissed places are back in the mix.");
            }}
          >
            <RotateCcw size={16} />
            Give them another chance
          </button>
        </div>
      )}
      {creating && (
        <Modal
          title="A little collection of your own"
          onClose={() => setCreating(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              const id = `custom-${Date.now()}`;
              update((s) => ({
                ...s,
                collections: [
                  ...s.collections,
                  { id, name: name.trim().slice(0, 50), places: [] },
                ],
              }));
              setCollection(id);
              setCreating(false);
              setName("");
              toast("Collection created. Add a place from its detail page.");
            }}
          >
            <label className="field-label">
              Give it a name
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={50}
                placeholder="Slow Sundays, perhaps"
                required
              />
            </label>
            <button className="button full" type="submit">
              Create collection
              <Plus size={18} />
            </button>
          </form>
        </Modal>
      )}
      {plan && <ItineraryDialog initial={plan} onClose={() => setPlan(null)} />}
    </div>
  );
}
