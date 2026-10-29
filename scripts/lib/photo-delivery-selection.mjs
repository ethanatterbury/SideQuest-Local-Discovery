import { loadProvider } from "./provider-loader.mjs";

const { websiteDiscoveryIdentity } = loadProvider(
  "src/providers/prepared-venue-photos.ts",
);
const { approvedPhoto } = loadProvider("src/providers/photo-policy.ts");
export const PHOTO_DELIVERY_SCREENSHOT_LIMIT = 12;
export const PHOTO_DELIVERY_TTL_MS = 30 * 86400000;

/** Scope the publication gate to the two externally hosted prepared sources. */
export function photoNeedsDelivery(entry) {
  const image = entry?.image;
  return !!(
    image &&
    (image.rights === "website-preview" ||
      (image.rights === "open" &&
        image.strategy === "geograph-commons-source-id")) &&
    approvedPhoto(image, entry.checkedAt)
  );
}

/** Commons may use Next's same-origin optimizer; its embedded source must match. */
export function photoDeliveryUrlMatches(value, image, pageUrl) {
  if (typeof value !== "string") return false;
  if (value === image.url) return true;
  if (
    image.rights !== "open" ||
    image.strategy !== "geograph-commons-source-id"
  )
    return false;
  try {
    const page = new URL(pageUrl);
    const url = new URL(value, page);
    return (
      url.origin === page.origin &&
      url.pathname === "/_next/image" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.searchParams.getAll("url").length === 1 &&
      url.searchParams.get("url") === image.url
    );
  } catch {
    return false;
  }
}

/** Use the same immutable selection time in the browser and reconciliation. */
export function photoDeliverySelectionTime(fallback = Date.now()) {
  const configured = process.env.SIDEQUEST_PHOTO_DELIVERY_AT;
  const now = configured ? Date.parse(configured) : fallback;
  if (!Number.isFinite(now))
    throw new Error("Invalid photo delivery selection time");
  return now;
}

/** Only prior browser proof for the exact same venue, image and source is reusable. */
export function photoDeliveryChecks({ before, after, now = Date.now() }) {
  const previous = new Map(
    before.entries.map((entry) => [
      websiteDiscoveryIdentity(entry.query),
      entry,
    ]),
  );
  return after.entries
    .filter((entry) => {
      if (!photoNeedsDelivery(entry)) return false;
      const prior = previous.get(websiteDiscoveryIdentity(entry.query));
      const verified = Date.parse(prior?.deliveryVerifiedAt);
      const age = now - verified;
      return !(
        photoNeedsDelivery(prior) &&
        prior.image.rights === entry.image.rights &&
        prior.image.strategy === entry.image.strategy &&
        prior.image.url === entry.image.url &&
        prior.image.source === entry.image.source &&
        prior.image.credit === entry.image.credit &&
        prior.image.license === entry.image.license &&
        !prior.deliveryFailure &&
        !entry.deliveryFailure &&
        Number.isFinite(age) &&
        age >= 0 &&
        age < PHOTO_DELIVERY_TTL_MS
      );
    })
    .map((entry, index) => ({
      entry,
      screenshot: index < PHOTO_DELIVERY_SCREENSHOT_LIMIT,
    }));
}
