"use client";
import { useState } from "react";
import { LocateFixed, MapPin, ArrowRight, Search } from "lucide-react";
import { Modal } from "./primitives";
import { useApp } from "./providers";
import { geocoder, TOWNS } from "@/providers/geocoding";
import type { Location } from "@/domain/models";
export function LocationPicker({ onClose }: { onClose: () => void }) {
  const { env, setLocation, toast } = useApp();
  const [text, setText] = useState(""),
    [results, setResults] = useState<Location[]>(TOWNS),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const choose = (l: Location) => {
    setLocation(l);
    toast(`Starting from ${l.name}`);
    onClose();
  };
  async function search() {
    setBusy(true);
    setError("");
    try {
      const r = await geocoder.search(text);
      setResults(r);
      if (!r.length)
        setError("No match. Try a nearby town or latitude, longitude.");
    } catch {
      setError(
        "Town search is unavailable. Choose a nearby town, or enter coordinates.",
      );
    } finally {
      setBusy(false);
    }
  }
  function locate() {
    setError("");
    setBusy(true);
    if (env.failures.includes("location-denied")) {
      setError("Location access is off. Pick your starting town below.");
      setBusy(false);
      return;
    }
    if (env.failures.includes("location-timeout")) {
      setError("Location took too long. Pick a town and keep going.");
      setBusy(false);
      return;
    }
    if (!navigator.geolocation) {
      setError("This browser cannot find your location. Choose a town below.");
      setBusy(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setBusy(false);
        choose({
          name: "Your location",
          lat: p.coords.latitude,
          lng: p.coords.longitude,
        });
      },
      (e) => {
        setBusy(false);
        setError(
          e.code === 1
            ? "Location access is off. No problem — choose your town."
            : "Couldn’t find you just now. Choose a town below.",
        );
      },
      { timeout: 10000, maximumAge: 300000 },
    );
  }
  return (
    <Modal title="Where are you starting from?" onClose={onClose}>
      <p className="dialog-intro">
        A good escape starts nearby. Your precise location stays on this device.
      </p>
      <button className="button full" onClick={locate} disabled={busy}>
        <LocateFixed size={18} /> Use my location <ArrowRight size={18} />
      </button>
      <form
        className="search-field"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <Search size={18} />
        <input
          aria-label="Starting town or coordinates"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResults(
              TOWNS.filter((t) =>
                t.name.toLowerCase().includes(e.target.value.toLowerCase()),
              ),
            );
          }}
          placeholder="Town, city, or latitude, longitude"
        />
        <button type="submit" aria-label="Find location" disabled={busy}>
          <ArrowRight size={20} />
        </button>
      </form>
      {error && (
        <p className="notice" role="status">
          {error}
        </p>
      )}
      <div className="town-list">
        {results.map((t) => (
          <button key={t.name} onClick={() => choose(t)}>
            <MapPin size={16} />
            <span>{t.name}</span>
            <ArrowUpRightIcon />
          </button>
        ))}
      </div>
      <p className="fine-print">
        Current seed coverage: Surrey, Berkshire & Hampshire. Other locations
        work, but curated options may be further away.
      </p>
    </Modal>
  );
}
function ArrowUpRightIcon() {
  return <ArrowRight size={15} />;
}
