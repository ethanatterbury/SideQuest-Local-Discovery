"use client";
import dynamic from "next/dynamic";
import type { Itinerary } from "@/domain/models";
const Map = dynamic(() => import("./map-view").then((m) => m.MapView), {
  ssr: false,
  loading: () => (
    <div className="map-loading">
      <span className="loading-dot" />
      <p>A little perspective is on its way.</p>
    </div>
  ),
});
export function LazyMap({ itinerary }: { itinerary?: Itinerary }) {
  return <Map itinerary={itinerary} />;
}
