"use client";
import { useEffect, useState } from "react";
import { useApp } from "@/components/providers";
import { EmptyState } from "@/components/primitives";
import { PlaceDetail } from "./place-detail";
export function DynamicPlace({ id }: { id: string }) {
  const { places, rememberPlace, ready } = useApp();
  const place = places.find((p) => p.id === id);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!ready || place) return;
    const controller = new AbortController();
    setFailed(false);
    fetch(`/api/places/${encodeURIComponent(id)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw Error("Place unavailable");
        return response.json();
      })
      .then(rememberPlace)
      .catch((error) => {
        if (error.name !== "AbortError") setFailed(true);
      });
    return () => controller.abort();
  }, [id, place, ready, rememberPlace, retry]);
  if (place) return <PlaceDetail place={place} />;
  return (
    <div className="page-container">
      <EmptyState
        title={
          failed
            ? "This place is taking a breather."
            : "Finding your next good idea…"
        }
        text={
          failed
            ? "The live source is unavailable or this place has changed. Try again, or discover something else nearby."
            : "Loading the latest place information."
        }
        action={failed ? () => setRetry((n) => n + 1) : undefined}
      />
    </div>
  );
}
