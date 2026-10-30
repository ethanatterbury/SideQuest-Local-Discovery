"use client";
import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
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
import { inUK } from "@/domain/geo-cells";
import { TOWNS } from "@/providers/geocoding";
import { openMeteo } from "@/providers/weather";
import { applyOverrides, unavailableWeather } from "@/domain/environment";
import { usePlaceCatalog } from "@/providers/place-catalog";
import type { OutingPlan } from "@/domain/planning";
import { WEATHER_PRESETS } from "@/domain/environment";
const labEnabled = true;
export const LAB_ENABLED = labEnabled;
type AppContext = ReturnType<typeof usePlaceCatalog> & {
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
  liveNow: string;
  plan: OutingPlan;
  setPlan: (plan: OutingPlan) => void;
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
  const [plan, setPlanState] = useState<OutingPlan>({});
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
    try {
      const restored = JSON.parse(
        localStorage.getItem("sidequest:location:v2") || "null",
      );
      if (restored && typeof restored.name === "string" && inUK(restored))
        setLocationState(restored);
    } catch {
      /* A starting location is optional. */
    }
    setState(saved);
    try {
      const restored = JSON.parse(
        sessionStorage.getItem("sidequest:outing-plan:v1") || "{}",
      );
      if (restored && typeof restored === "object")
        setPlanState({
          ...(typeof restored.at === "string" &&
          Number.isFinite(Date.parse(restored.at)) &&
          Math.abs(Date.parse(restored.at) - Date.now()) < 7 * 86400000
            ? { at: restored.at }
            : {}),
          ...(typeof restored.weather === "string" &&
          Object.hasOwn(WEATHER_PRESETS, restored.weather)
            ? { weather: restored.weather }
            : {}),
        });
    } catch {
      /* Planning is optional session state. */
    }
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
  const activeOverrides = useMemo(
    () =>
      process.env.NODE_ENV !== "production" || pathname === "/dev/environment"
        ? overrides
        : {},
    [overrides, pathname],
  );
  const activeLocation = activeOverrides.location || location;
  const plannedAt = pathname === "/dev/environment" ? undefined : plan.at;
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const refresh = () =>
      openMeteo.get(activeLocation, controller.signal, plannedAt).then((w) => {
        if (!controller.signal.aborted) setWeather(w);
      });
    refresh();
    const timer = setInterval(refresh, 15 * 60000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [activeLocation, ready, plannedAt]);
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
  const setLocation = useCallback((next: Location) => {
    if (!inUK(next)) {
      setMessage("Choose a starting point in the UK.");
      return;
    }
    setLocationState(next);
    setWeather(unavailableWeather());
    try {
      localStorage.setItem("sidequest:location:v2", JSON.stringify(next));
    } catch {}
  }, []);
  const setOverrides = useCallback((o: EnvironmentOverrides) => {
    if (!labEnabled) return;
    setOverridesState(o);
    try {
      sessionStorage.setItem("sidequest:environment", JSON.stringify(o));
    } catch {}
  }, []);
  const setPlan = useCallback(
    (next: OutingPlan) => {
      setPlanState(next);
      if (next.at !== plan.at) setWeather(unavailableWeather(next.at));
      try {
        sessionStorage.setItem(
          "sidequest:outing-plan:v1",
          JSON.stringify(next),
        );
      } catch {
        /* Session-only in private mode. */
      }
    },
    [plan.at],
  );
  const base = useMemo<Environment>(
    () => ({
      location,
      now: plannedAt || now || "2026-10-07T12:00:00Z",
      weather,
      reducedMotion,
      failures: offline ? ["offline"] : [],
    }),
    [location, plannedAt, now, weather, reducedMotion, offline],
  );
  const env = useMemo(
    () =>
      applyOverrides(base, {
        ...(pathname !== "/dev/environment" && plan.weather
          ? { weather: plan.weather }
          : {}),
        ...activeOverrides,
      }),
    [base, pathname, plan.weather, activeOverrides],
  );
  const catalog = usePlaceCatalog(env, query, ready, state);
  return (
    <Context.Provider
      value={{
        ...catalog,
        state,
        update,
        env,
        setLocation,
        query,
        setQuery,
        overrides,
        setOverrides,
        toast: setMessage,
        storageAvailable,
        ready,
        liveNow: now || "2026-10-07T12:00:00Z",
        plan,
        setPlan,
      }}
    >
      <div
        className={`app-root${env.reducedMotion ? " reduce-motion" : activeOverrides.reducedMotion === false ? " normal-motion" : ""}`}
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
