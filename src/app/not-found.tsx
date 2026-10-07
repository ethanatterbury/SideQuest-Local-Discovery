import Link from "next/link";
export default function NotFound() {
  return (
    <div className="page-container empty-state">
      <h1>A little off the path.</h1>
      <p>This place or page isn’t here. There’s still something good nearby.</p>
      <Link className="button" href="/">
        Find a fresh SideQuest
      </Link>
    </div>
  );
}
