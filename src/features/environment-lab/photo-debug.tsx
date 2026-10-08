"use client";
import { useState } from "react";
import { useApp } from "@/components/providers";
import { PlaceImage } from "@/components/primitives";
import {
  indexedPhoto,
  photoIndex,
  placePhotoQuery,
} from "@/providers/photo-index";
import type { PhotoResult } from "@/providers/place-photo";
import type { Place } from "@/domain/models";
export function PhotoDebug({ places }: { places: Place[] }) {
  const { rememberPhoto } = useApp();
  const [selected, setSelected] = useState("");
  const [result, setResult] = useState<PhotoResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const place = places.find((p) => p.id === selected) || places[0];
  const visible = places.slice(0, 50);
  const matched = visible.filter(
    (p) => p.image || indexedPhoto(placePhotoQuery(p))?.image,
  ).length;
  async function inspect(refresh: boolean) {
    if (!place || loading) return;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      debug: "1",
      ...(refresh ? { refresh: "1" } : {}),
    });
    for (const [key, value] of Object.entries(placePhotoQuery(place))) {
      if (value !== undefined)
        params.set(
          key,
          Array.isArray(value) ? JSON.stringify(value) : String(value),
        );
    }
    try {
      const response = await fetch(`/api/photo?${params}`, {
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok)
        throw new Error(`Photo service returned ${response.status}`);
      const data: PhotoResult = await response.json();
      setResult(data);
      if (data.image) rememberPhoto(place.id, data.image);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Photo lookup failed");
    } finally {
      setLoading(false);
    }
  }
  return (
    <details className="lab-photo-debug" open>
      <summary>Photo coverage & inspection</summary>
      <p>
        <strong>
          {matched}/{visible.length}
        </strong>{" "}
        recommendations have matched photo metadata. Ranking is independent of
        photos.
      </p>
      {photoIndex.sample && (
        <p>
          Recorded sample:{" "}
          <strong>
            {photoIndex.sample.matched}/{photoIndex.sample.tested}
          </strong>{" "}
          matched · {photoIndex.sample.label} ·{" "}
          {photoIndex.generatedAt?.slice(0, 10)}. This is a measured sample, not
          regional completeness.
          {photoIndex.sample.retryable
            ? ` ${photoIndex.sample.retryable} lookups need another attempt after a provider failure.`
            : ""}
        </p>
      )}
      <label>
        Inspect place
        <select
          aria-label="Inspect place photo"
          value={place?.id || ""}
          onChange={(e) => {
            setSelected(e.target.value);
            setResult(null);
            setError("");
          }}
        >
          {places.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.area} · {p.id}
            </option>
          ))}
        </select>
      </label>
      {place && (
        <>
          <p>
            {place.coordinates.lat.toFixed(5)},{" "}
            {place.coordinates.lng.toFixed(5)}
          </p>
          <div className="lab-photo-preview">
            <PlaceImage place={place} />
          </div>
        </>
      )}
      <div className="lab-photo-actions">
        <button
          className="button secondary"
          disabled={loading || !place}
          onClick={() => inspect(false)}
        >
          {loading ? "Resolving…" : "Inspect photo"}
        </button>
        <button
          className="text-link"
          disabled={loading || !place}
          onClick={() => inspect(true)}
        >
          Recheck sources
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {result && (
        <div aria-live="polite">
          <p>
            {result.image
              ? "Matched venue photo"
              : result.retryable
                ? "Provider failure — retry later"
                : "No verified reusable photo found"}{" "}
            · {result.source}
          </p>
          {result.image && (
            <>
              <p>
                {result.image.width || "?"} × {result.image.height || "?"} ·
                confidence evidence{" "}
                {result.image.confidence?.toFixed(2) || "not recorded"} ·{" "}
                {result.image.strategy || "not recorded"}
              </p>
              <a
                className="text-link"
                href={result.image.source}
                target="_blank"
                rel="noreferrer"
              >
                {result.image.credit} · {result.image.license}
              </a>
              <p>{result.image.matched?.join(" · ")}</p>
            </>
          )}
          {result.diagnostics && (
            <>
              <p>
                Strategy: {result.diagnostics.strategy || "unresolved"} ·{" "}
                {result.diagnostics.candidateCount} candidates ·{" "}
                {result.diagnostics.requestCount} requests ·{" "}
                {result.diagnostics.elapsedMs}ms
                {result.diagnostics.cacheHit ? " · cached" : ""}
              </p>
              <p>
                Sources:{" "}
                {result.diagnostics.sourcesAttempted.join(" → ") || "index"}
              </p>
              {result.diagnostics.upstreamErrors && (
                <p>
                  Provider errors:{" "}
                  {Object.entries(result.diagnostics.upstreamErrors)
                    .map(([reason, count]) => `${reason}: ${count}`)
                    .join(" · ")}
                  {result.diagnostics.retryAfterMs
                    ? ` · retry after ${Math.ceil(result.diagnostics.retryAfterMs / 1000)}s`
                    : ""}
                </p>
              )}
              <ul>
                {Object.entries(result.diagnostics.rejected).map(
                  ([reason, count]) => (
                    <li key={reason}>
                      {reason}: {count}
                    </li>
                  ),
                )}
              </ul>
            </>
          )}
        </div>
      )}
    </details>
  );
}
