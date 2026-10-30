"use client";
import { useEffect, useState } from "react";
import { ArrowRight, ArrowUpRight, Search } from "lucide-react";

/** Draft keystrokes never enter the shared discovery state or the router. */
export function PlaceSearch({
  value,
  onSearch,
  className,
  label,
  buttonLabel,
  map = false,
}: {
  value: string;
  onSearch: (text: string) => void;
  className: string;
  label: string;
  buttonLabel: string;
  map?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <form
      className={className}
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(draft.trim().slice(0, 200));
      }}
    >
      <Search size={map ? 17 : 19} aria-hidden="true" />
      <input
        type="search"
        aria-label={label}
        placeholder="Search places or activities"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        maxLength={200}
      />
      <button type="submit" aria-label={buttonLabel}>
        {map ? <ArrowUpRight size={17} /> : <ArrowRight size={20} />}
      </button>
    </form>
  );
}
