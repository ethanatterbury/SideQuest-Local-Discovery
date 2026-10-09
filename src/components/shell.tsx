"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  Search,
  Sun,
  CloudRain,
  Cloud,
  Moon,
  Map,
  Bookmark,
  Footprints,
  Sparkles,
  Compass,
  FlaskConical,
} from "lucide-react";
import { LocationTransition } from "./location-transition";
import { Mark, Modal } from "./primitives";
import { LocationPicker } from "./location-picker";
import { useApp, LAB_ENABLED } from "./providers";
import { isDark } from "@/domain/time";
const nav = [
  { href: "/", label: "Discover", Icon: Sparkles },
  { href: "/explore", label: "Explore", Icon: Compass },
  { href: "/map", label: "Map", Icon: Map },
  { href: "/saved", label: "Saved", Icon: Bookmark },
  { href: "/history", label: "Been there", Icon: Footprints },
];
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { env, ready, state, storageAvailable, toast } = useApp();
  const [locationOpen, setLocationOpen] = useState(false),
    [searchOpen, setSearchOpen] = useState(false),
    [installEvent, setInstallEvent] = useState<Event | null>(null);
  const WeatherIcon =
    env.weather.rain > 0
      ? CloudRain
      : isDark(env.now, env.weather.sunrise, env.weather.sunset)
        ? Moon
        : env.weather.kind === "clear" || env.weather.kind === "sunny"
          ? Sun
          : Cloud;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((s) => !s);
      }
    };
    window.addEventListener("keydown", onKey);
    const install = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e);
    };
    window.addEventListener("beforeinstallprompt", install);
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeinstallprompt", install);
    };
  }, []);
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <LocationTransition />
      <header className="header">
        <Link className="brand" href="/" aria-label="SideQuest home">
          <Mark />
          <span>
            sidequest<span className="brand-dot">.</span>
          </span>
        </Link>
        <nav className="desktop-nav" aria-label="Main navigation">
          {nav.map(({ href, label }) => (
            <Link
              href={href}
              key={href}
              className={path === href ? "active" : ""}
            >
              {label}
              {href === "/saved" && state.saved.length > 0 && (
                <span className="nav-count">{state.saved.length}</span>
              )}
            </Link>
          ))}
        </nav>
        <div className="header-tools">
          <button
            className="location-button"
            onClick={() => setLocationOpen(true)}
            aria-label={`Change starting location: ${env.location.name}`}
          >
            <span className="location-dot" />
            {env.location.name}
            <ChevronDown size={14} />
          </button>
          <button
            className="icon-button search-toggle"
            aria-label="Search places and ideas"
            onClick={() => setSearchOpen(true)}
          >
            <Search size={19} />
          </button>
        </div>
      </header>
      <div className="context-bar">
        <span className="context-weather">
          <WeatherIcon size={17} />
          {ready && env.weather.source !== "unavailable" ? (
            <>
              {Math.round(env.weather.temperature)}°{" "}
              <span className="desktop-only">
                {env.weather.kind.replaceAll("-", " ")}
              </span>
              <span className="weather-source">
                {env.weather.source === "simulation"
                  ? "Simulated"
                  : env.weather.source === "cached"
                    ? "Cached forecast"
                    : "Local forecast"}
              </span>
            </>
          ) : (
            <>
              Forecast unavailable{" "}
              <span className="desktop-only">— discovery still works</span>
            </>
          )}
        </span>
        <span className="context-date">
          {ready
            ? new Intl.DateTimeFormat("en-GB", {
                weekday: "long",
                day: "numeric",
                month: "long",
                timeZone: "Europe/London",
              }).format(new Date(env.now))
            : "A good day for a change of scene"}{" "}
          <span className="context-separator">/</span> A little closer to
          somewhere good
          <ArrowUpRight size={14} />
        </span>
      </div>
      {!storageAvailable && (
        <div className="connection-notice" role="status">
          Storage is unavailable. Your choices work for this session, but won’t
          survive a reload.
        </div>
      )}
      {env.failures.includes("offline") && (
        <div className="connection-notice" role="status">
          You’re offline. Your local saved places and curated ideas are still
          here.
        </div>
      )}
      <main id="main">{children}</main>
      <footer className="footer">
        <Link className="brand small" href="/">
          <Mark />
          <span>sidequest.</span>
        </Link>
        <span>Stop scrolling. Go somewhere.</span>
        <div>
          {installEvent && (
            <button
              onClick={async () => {
                const e = installEvent as Event & {
                  prompt: () => Promise<void>;
                };
                await e.prompt();
                setInstallEvent(null);
              }}
            >
              Install SideQuest
            </button>
          )}
          <Link href="/about">Good to know</Link>
          {LAB_ENABLED && (
            <Link href="/dev/environment" aria-label="Environment Lab">
              <FlaskConical size={16} />
            </Link>
          )}
          <button
            onClick={() =>
              toast(
                "On iPhone: Share → Add to Home Screen. On Android: use your browser’s install option.",
              )
            }
          >
            Add to home screen
          </button>
        </div>
      </footer>
      <nav className="mobile-nav" aria-label="Main navigation">
        {nav.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            className={path === href ? "active" : ""}
          >
            <Icon size={21} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
      {locationOpen && (
        <LocationPicker onClose={() => setLocationOpen(false)} />
      )}{" "}
      {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} />}
    </>
  );
}
function SearchDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  return (
    <Modal title="Have something in mind?" onClose={onClose}>
      <form action="/explore">
        <div className="search-field">
          <Search size={18} />
          <input
            autoFocus
            name="q"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="A place, or ‘something indoors with kids’"
            aria-label="Search places or natural language ideas"
          />
          <button type="submit" aria-label="Search">
            <ArrowUpRight size={20} />
          </button>
        </div>
      </form>
      <p className="fine-print">
        Try a town, a place, or a mood. SideQuest turns familiar phrases into
        simple filters.
      </p>
      <div className="search-suggestions">
        {[
          "Somewhere beautiful",
          "Something indoors with kids",
          "A free walk",
          "Something unusual",
        ].map((s) => (
          <Link
            href={`/explore?q=${encodeURIComponent(s)}`}
            onClick={onClose}
            key={s}
          >
            {s}
            <ArrowUpRight size={17} />
          </Link>
        ))}
      </div>
    </Modal>
  );
}
