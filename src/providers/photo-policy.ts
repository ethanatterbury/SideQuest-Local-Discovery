import type { Place } from "@/domain/models";
import { parseArchivePhotoUrl, safeArchivePhotoUrl } from "./archive-photo";

type Image = NonNullable<Place["image"]>;
export type PhotoPermission = {
  evidenceUrl: string;
  grantedAt: string;
  allowsRedistribution: true;
};
type Candidate = Image & { permission?: PhotoPermission };
export const PHOTO_DEADLINE_MS = 4500;
export const PHOTO_NEGATIVE_TTL_MS = 7 * 86400000;
export const PHOTO_TRANSIENT_TTL_MS = 30000;

/** Attribution describes authorship. Only an explicit reuse license grants reuse. */
export function openPhotoLicense(license: string): boolean {
  return /^(?:CC(?:0| BY(?:-SA)?)(?: [0-9.]+)?|Public domain)$/i.test(
    license.trim(),
  );
}

/** Preserve prepared evidence; never upgrade a rights-reserved photo through attribution. */
export function approvedPhoto(
  image: Candidate | null | undefined,
  checkedAt?: string,
  allowPermissioned = false,
): Image | undefined {
  if (!image || !image.credit?.trim() || !image.source?.startsWith("https://"))
    return;
  const open = openPhotoLicense(image.license);
  try {
    const source = new URL(image.source);
    if (
      source.username ||
      source.password ||
      source.port ||
      source.protocol !== "https:"
    )
      return;
    if (open) {
      const commons =
        source.hostname === "commons.wikimedia.org" &&
        source.pathname.startsWith("/wiki/File:");
      const archive = safeArchivePhotoUrl(image.source, true);
      if (!commons && !archive) return;
      if (
        !image.url.startsWith("/images/") &&
        !/^\/venue-images\/[a-z0-9-]+-[a-f0-9]{12,16}\.webp$/.test(image.url)
      ) {
        const url = new URL(image.url);
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.port
        )
          return;
        if (
          commons &&
          !(
            url.hostname === "upload.wikimedia.org" &&
            url.pathname.startsWith("/wikipedia/commons/")
          )
        )
          return;
        if (
          archive &&
          !(
            safeArchivePhotoUrl(image.url) &&
            parseArchivePhotoUrl(image.url)?.source === image.source
          )
        )
          return;
      }
    }
  } catch {
    return;
  }
  const permission = image.permission;
  if (
    !open &&
    !(
      allowPermissioned &&
      image.rights === "permissioned" &&
      permission?.allowsRedistribution === true &&
      /^https:\/\//.test(permission.evidenceUrl) &&
      Number.isFinite(Date.parse(permission.grantedAt))
    )
  )
    return;
  const timestamp = image.checkedAt || checkedAt;
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return;
  return {
    ...image,
    rights: open ? "open" : "permissioned",
    checkedAt: timestamp,
  };
}
