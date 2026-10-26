import type { Place } from "@/domain/models";
import { approvedPhoto } from "./photo-policy";
type Image = NonNullable<Place["image"]>;

/** Only compare candidates whose venue identity has already been checked by the caller. */
export function selectPreparedPhoto(
  candidates: (Image | null | undefined)[],
): Image | undefined {
  const photos = candidates
    .map((p) => approvedPhoto(p))
    .filter((p): p is Image => !!p);
  const confidence = (p: Image) =>
    Number.isFinite(p.confidence) ? Math.max(0, Math.min(1, p.confidence!)) : 0;
  const strongest = Math.max(0, ...photos.map(confidence));
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
  const contenders = photos.filter((p) => confidence(p) >= strongest - 0.099);
  // A prepared 1280px card rendition already represents the same original photo.
  // Keep its local delivery/blur metadata instead of introducing a needless remote fetch.
  const unique = contenders.filter(
    (p) =>
      !contenders.some(
        (local) =>
          local !== p &&
          local.source === p.source &&
          local.url.startsWith("/") &&
          !p.url.startsWith("/") &&
          (local.width ?? 0) >= Math.min(1280, p.width ?? 0) &&
          confidence(local) >= confidence(p),
      ),
  );
  return unique.sort(
    (a, b) => quality(b) - quality(a) || confidence(b) - confidence(a),
  )[0];
}
