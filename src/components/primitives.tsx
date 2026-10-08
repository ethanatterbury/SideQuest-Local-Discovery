"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  X,
  Trees,
  Landmark,
  Waves,
  Mountain,
  ArrowUpRight,
} from "lucide-react";
import Image from "next/image";
import { useApp } from "@/components/providers";
import { findPlacePhoto } from "@/providers/photo-client";
import type { Place } from "@/domain/models";
export function Mark() {
  return (
    <svg
      width="29"
      height="32"
      viewBox="0 0 29 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6 27V15c0-4 3-7 7-7h10M6 17l15 10M18 3l6 5-6 5"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export function PlaceImage({
  place,
  className = "",
  priority = false,
}: {
  place: Place;
  className?: string;
  priority?: boolean;
}) {
  const { places, rememberPhoto } = useApp();
  const image = places.find((p) => p.id === place.id)?.image || place.image;
  const imageSource = image?.url.startsWith("https://upload.wikimedia.org/")
    ? image.url.split(/[?#]/)[0]
    : image?.url;
  const container = useRef<HTMLDivElement>(null);
  const [looking, setLooking] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (image || !container.current) return;
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        setLooking(true);
        findPlacePhoto(place).then((photo) => {
          if (cancelled) return;
          if (photo) rememberPhoto(place.id, photo);
          setLooking(false);
        });
      },
      { rootMargin: "250px" },
    );
    observer.observe(container.current);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [place, image, rememberPhoto]);
  useEffect(() => setFailed(false), [place.id]);
  const Icon =
    place.category.includes("lake") || place.id === "virginia-water"
      ? Waves
      : place.environment === "indoor"
        ? Landmark
        : place.exposed
          ? Mountain
          : Trees;
  return (
    <div
      ref={container}
      className={`place-image ${className} ${!image || failed ? "image-fallback" : ""}`}
      style={{
        backgroundColor: place.environment === "indoor" ? "#dad5c2" : "#ccd3b4",
      }}
    >
      {image && !failed ? (
        <Image
          src={imageSource!}
          unoptimized={!image.url.startsWith("https://upload.wikimedia.org/")}
          sizes="(max-width: 640px) 100vw, (max-width: 1100px) 50vw, 800px"
          alt={place.name}
          width={1280}
          height={800}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="fallback-content">
          <Icon size={48} strokeWidth={1} />
          <span>{place.category}</span>
          <small>
            {looking
              ? "Finding a photo…"
              : failed
                ? "Photo unavailable"
                : place.area}
          </small>
        </div>
      )}
    </div>
  );
}
export function Modal({
  children,
  title,
  onClose,
  wide = false,
}: {
  children: ReactNode;
  title: string;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    const previous = document.activeElement as HTMLElement;
    d?.showModal();
    const scroll = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = scroll;
      d?.close();
      queueMicrotask(() => previous?.focus());
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-top">
        <span>{title}</span>
        <button className="icon-button" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function EmptyState({
  title,
  text,
  action,
  children,
}: {
  title: string;
  text: string;
  action?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Mark />
      <h2>{title}</h2>
      <p>{text}</p>
      {action && (
        <button className="button" onClick={action}>
          Widen the search <ArrowUpRight size={18} />
        </button>
      )}
      {children}
    </div>
  );
}
export async function shareUrl(
  url: string,
  title: string,
  toast: (s: string) => void,
) {
  try {
    if (navigator.share) {
      await navigator.share({ title, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    toast("Link copied. Send it to your favourite co-adventurer.");
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return;
    window.prompt("Copy this link to share", url);
  }
}
