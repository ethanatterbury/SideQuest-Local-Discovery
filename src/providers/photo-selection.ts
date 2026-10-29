import type { Place } from "@/domain/models";
import { approvedPhoto } from "./photo-policy";
type Image = NonNullable<Place["image"]>;
const geographAssertions = [
  "exact-geograph-source-id",
  "full venue name in Geograph subject title",
  "precise Geograph subject position within 150m",
];
function provenPhoto(image: Image): boolean {
  // The offline publication path supplies all three only after its scene review.
  // The source resolver also uses this strategy before review, so the label alone is insufficient.
  if (
    image.strategy === "geograph-commons-source-id" &&
    geographAssertions.every((assertion) => image.matched?.includes(assertion))
  )
    return true;
  const preview = image.preview;
  // approvedPhoto has validated the review, rights and branch contract before this tier is used.
  if (
    image.strategy !== "official-website-preview" ||
    image.rights !== "website-preview" ||
    !preview?.review
  )
    return false;
  // Existing manual reviews carry venue/branch identity in descriptive prose.
  // Preserve that approved evidence rather than requiring generated machine labels.
  if (preview.review.method === "visual-review")
    return preview.subjectEvidence.includes(
      "physical venue scene verified by visual review",
    );
  if (preview.review.method === "image-analysis:web-image-search")
    return preview.subjectEvidence.includes(
      "physical venue scene described by external image analysis",
    );
  return (
    preview.review.method === "image-analysis:local-clip" &&
    preview.identityEvidence.includes(
      "venue name in page title, heading or business schema",
    ) &&
    preview.identityEvidence.some((evidence) =>
      [
        "venue area in page metadata, path or business address",
        "venue address matched",
        "venue coordinates matched",
      ].includes(evidence),
    ) &&
    preview.subjectEvidence.includes(
      "physical venue scene classified by local model",
    )
  );
}
function originalIdentity(image: Image): string {
  const source = new URL(image.source);
  if (
    source.hostname === "commons.wikimedia.org" &&
    source.pathname.startsWith("/wiki/File:")
  ) {
    try {
      return `commons:${decodeURIComponent(source.pathname.slice(11))
        .replace(/_/g, " ")
        .normalize("NFC")}`;
    } catch {
      // Malformed escapes cannot establish equivalence with another rendition.
    }
  }
  if (
    source.hostname === "archive.org" &&
    source.pathname.startsWith("/details/")
  )
    return image.source;
  // A publisher page can contain several different photos; it is not an original-file identity.
  return JSON.stringify([image.source, image.url]);
}

/** Only compare candidates whose venue identity has already been checked by the caller. */
export function selectPreparedPhoto(
  candidates: (Image | null | undefined)[],
): Image | undefined {
  const photos = candidates
    .map((p) => approvedPhoto(p))
    .filter((p): p is Image => !!p);
  const confidence = (p: Image) =>
    Number.isFinite(p.confidence) ? Math.max(0, Math.min(1, p.confidence!)) : 0;
  const quality = (p: Image) => {
    const width = p.width ?? 0,
      height = p.height ?? 0,
      ratio = width / height;
    return (
      Math.min(1, Math.max(0, width) / 2400) +
      (ratio >= 1.15 && ratio <= 2.3
        ? 0.5
        : ratio >= 0.9 && ratio <= 3
          ? 0.2
          : 0)
    );
  };
  const byOriginal = new Map<string, Image[]>();
  for (const photo of photos) {
    const key = originalIdentity(photo);
    const group = byOriginal.get(key);
    if (group) group.push(photo);
    else byOriginal.set(key, [photo]);
  }
  const originals = [...byOriginal.values()].map((group) => {
    const provenance = [...group].sort(
      (a, b) =>
        Number(provenPhoto(b)) - Number(provenPhoto(a)) ||
        confidence(b) - confidence(a),
    )[0];
    const proven = provenPhoto(provenance);
    const eligible = proven
      ? group
      : group.filter(
          (photo) => confidence(photo) >= confidence(provenance) - 0.099,
        );
    const order = (a: Image, b: Image) =>
      quality(b) - quality(a) || confidence(b) - confidence(a);
    // Keep the existing card-size requirement while sharing provenance only across the same original.
    const minimumLocalWidth = Math.min(
      1280,
      Math.max(...eligible.map((p) => p.width ?? 0)),
    );
    const local = eligible
      .filter(
        (photo) =>
          photo.url.startsWith("/") && (photo.width ?? 0) >= minimumLocalWidth,
      )
      .sort(order)[0];
    const rendition = local || [...eligible].sort(order)[0];
    return {
      proven,
      confidence: confidence(provenance),
      image: {
        ...provenance,
        url: rendition.url,
        width: rendition.width,
        height: rendition.height,
        blurDataURL: rendition.blurDataURL,
      },
    };
  });
  const bestTier = originals.some((original) => original.proven);
  const tier = originals.filter((original) => original.proven === bestTier);
  const strongest = Math.max(0, ...tier.map((original) => original.confidence));
  return tier
    .filter((original) => original.confidence >= strongest - 0.099)
    .sort(
      (a, b) =>
        quality(b.image) - quality(a.image) || b.confidence - a.confidence,
    )[0]?.image;
}
