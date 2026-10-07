import Link from "next/link";
export const metadata = { title: "A little off the grid" };
export default function Offline() {
  return (
    <div className="page-container empty-state">
      <h1>A little off the grid.</h1>
      <p>
        You’re offline. Your saved places and the curated ideas you’ve loaded
        are still worth a look.
      </p>
      <Link className="button" href="/saved">
        Open saved places
      </Link>
      <Link className="button secondary" href="/">
        Try discovery
      </Link>
    </div>
  );
}
