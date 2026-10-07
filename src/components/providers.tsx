"use client";
import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import {
  DEFAULT_QUERY,
  type LocalState,
  type Location,
  type Environment,
  type EnvironmentOverrides,
  type DiscoveryQuery,
} from "@/domain/models";
import { emptyState, LocalPersistence } from "@/providers/persistence";
import { TOWNS } from "@/providers/geocoding";
import { openMeteo } from "@/providers/weather";
import { applyOverrides, unavailableWeather } from "@/domain/environment";
const labEnabled =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_ENABLE_ENVIRONMENT_LAB === "true";
export const LAB_ENABLED = labEnabled;
type AppContext = {
  state: LocalState;
  update: (fn: (s: LocalState) => LocalState) => void;
  env: Environment;
  setLocation: (l: Location) => void;
  query: DiscoveryQuery;
  setQuery: (q: DiscoveryQuery) => void;
  overrides: EnvironmentOverrides;
  setOverrides: (o: EnvironmentOverrides) => void;
  toast: (s: string) => void;
  storageAvailable: boolean;
  ready: boolean;
};
const Context = createContext<AppContext | null>(null);
export function useApp() {
  const c = useContext(Context);
  if (!c) throw Error("SideQuest provider missing");
  return c;
}
export function AppProviders({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState(emptyState),
    [query, setQueryState] = useState(DEFAULT_QUERY),
    [ready, setReady] = useState(false),
    [storageAvailable, setStorageAvailable] = useState(true),
    [message, setMessage] = useState("");
  const persistence = useRef<LocalPersistence | null>(null);
  const [location, setLocationState] = useState(TOWNS[0]);
  const [overrides, setOverridesState] = useState<EnvironmentOverrides>({});
  const [now, setNow] = useState("");
  const [weather, setWeather] = useState(
    unavailableWeather("2026-10-07T12:00:00Z"),
  );
  const [reducedMotion, setReducedMotion] = useState(false);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let store: Storage | null = null;
    try {
      store = window.localStorage;
    } catch {}
    persistence.current = new LocalPersistence(store);
    const saved = persistence.current.read();
    setState(saved);
    setStorageAvailable(persistence.current.available);
    setNow(new Date().toISOString());
    setWeather(unavailableWeather());
    setReady(true);
    if (labEnabled) {
      try {
        const o = JSON.parse(
          sessionStorage.getItem("sidequest:environment") || "{}",
        );
        if (o && typeof o === "object") setOverridesState(o);
      } catch {}
    }
    const params = new URLSearchParams(window.location.search);
    const q = { ...DEFAULT_QUERY, ...saved.preferences };
    const intent = params.get("intent");
    if (
      [
        "any",
        "scenic",
        "walk",
        "unusual",
        "relax",
        "culture",
        "active",
        "food",
        "date",
        "kids",
      ].includes(intent || "")
    )
      q.intent = intent as DiscoveryQuery["intent"];
    for (const k of ["minutes", "travel", "budget"] as const) {
      const raw = params.get(k);
      if (raw !== null && Number.isFinite(Number(raw)))
        q[k] = Math.max(
          k === "budget" ? 0 : 5,
          Math.min(k === "minutes" ? 720 : 200, Number(raw)),
        );
    }
    const text = params.get("q");
    if (text) q.text = text.slice(0, 200);
    setQueryState(q);
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(media.matches);
    const motion = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    media.addEventListener("change", motion);
    const connection = () => setOffline(!navigator.onLine);
    connection();
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
    const clock = setInterval(() => setNow(new Date().toISOString()), 60000);
    return () => {
      clearInterval(clock);
      media.removeEventListener("change", motion);
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams(window.location.search);
    const text = params.get("q");
    if (text !== null)
      setQueryState((q) => ({ ...q, text: text.slice(0, 200) }));
  }, [pathname, ready]);
  const activeLocation = overrides.location || location;
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const refresh = () =>
      openMeteo.get(activeLocation, controller.signal).then((w) => {
        if (!controller.signal.aborted) setWeather(w);
      });
    refresh();
    const timer = setInterval(refresh, 15 * 60000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [activeLocation, ready]);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(""), 4000);
    return () => clearTimeout(t);
  }, [message]);
  const update = useCallback((fn: (s: LocalState) => LocalState) => {
    setState((s) => {
      const next = fn(s);
      const ok = persistence.current?.write(next) ?? false;
      setStorageAvailable(ok);
      return next;
    });
  }, []);
  const setQuery = useCallback(
    (q: DiscoveryQuery) => {
      setQueryState(q);
      update((s) => ({ ...s, preferences: { ...q, text: "" } }));
      const url = new URL(window.location.href);
      for (const k of ["intent", "minutes", "travel", "budget"] as const)
        url.searchParams.set(k, String(q[k]));
      if (q.text) url.searchParams.set("q", q.text);
      else url.searchParams.delete("q");
      window.history.replaceState(null, "", url);
    },
    [update],
  );
  const setOverrides = useCallback((o: EnvironmentOverrides) => {
    if (!labEnabled) return;
    setOverridesState(o);
    try {
      sessionStorage.setItem("sidequest:environment", JSON.stringify(o));
    } catch {}
  }, []);
  const base: Environment = {
    location,
    now: now || "2026-10-07T12:00:00Z",
    weather,
    reducedMotion,
    failures: offline ? ["offline"] : [],
  };
  const env = applyOverrides(base, overrides);
  return (
    <Context.Provider
      value={{
        state,
        update,
        env,
        setLocation: setLocationState,
        query,
        setQuery,
        overrides,
        setOverrides,
        toast: setMessage,
        storageAvailable,
        ready,
      }}
    >
      <div
        className={env.reducedMotion ? "app-root reduce-motion" : "app-root"}
        data-weather={env.weather.kind}
      >
        {children}
      </div>
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </Context.Provider>
  );
}
