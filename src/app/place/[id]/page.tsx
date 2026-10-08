import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PLACES } from "@/providers/places";
import { DynamicPlace } from "@/features/place/dynamic-place";
import { PlaceDetail } from "@/features/place/place-detail";
export function generateStaticParams() {
  return PLACES.map((p) => ({ id: p.id }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const p = PLACES.find((p) => p.id === id);
  return {
    title:
      p?.name ||
      (/^osm-(node|way|relation)-[1-9]\d{0,15}$/.test(id)
        ? "A place worth going out for"
        : "Place not found"),
    description: p?.tagline,
    openGraph: {
      title: `Fancy ${p?.name || "a little SideQuest"}?`,
      description: p?.tagline,
      url: `/place/${id}`,
    },
  };
}
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const p = PLACES.find((p) => p.id === id);
  if (!p) {
    if (/^osm-(node|way|relation)-[1-9]\d{0,15}$/.test(id))
      return <DynamicPlace id={id} />;
    notFound();
  }
  return <PlaceDetail place={p} />;
}
