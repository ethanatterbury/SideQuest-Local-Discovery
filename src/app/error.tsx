"use client";
import Link from "next/link";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="page-container empty-state">
      <h1>A small detour.</h1>
      <p>
        Something didn’t load properly. Your saved places are still on this
        device.
      </p>
      <button className="button" onClick={reset}>
        Try again
      </button>
      <Link className="button secondary" href="/saved">
        Go to saved places
      </Link>
    </div>
  );
}
