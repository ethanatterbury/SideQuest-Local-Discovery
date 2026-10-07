import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PLACES } from "@/providers/places";
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
    title: p?.name || "Place not found",
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
  if (!p) notFound();
  return <PlaceDetail place={p} />;
}
