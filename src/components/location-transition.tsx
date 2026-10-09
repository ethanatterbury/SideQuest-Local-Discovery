"use client";
import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { useApp } from "./providers";

/** Acknowledges a location change without hiding usable results or waiting on a service. */
export function LocationTransition() {
  const { env } = useApp();
  const previous = useRef(env.location.name);
  const [name, setName] = useState("");
  useEffect(() => {
    if (previous.current === env.location.name) return;
    previous.current = env.location.name;
    setName(env.location.name);
    const timer = setTimeout(() => setName(""), env.reducedMotion ? 650 : 1200);
    return () => clearTimeout(timer);
  }, [env.location.name, env.reducedMotion]);
  return name ? (
    <div className="location-transition" role="status" key={name}>
      <MapPin size={16} strokeWidth={1.5} />
      <span>
        Starting from <strong>{name}</strong>
      </span>
      <span className="location-transition-line" aria-hidden="true" />
    </div>
  ) : null;
}
