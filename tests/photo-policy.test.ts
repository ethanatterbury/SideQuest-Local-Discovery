import { expect, it } from "vitest";
import { approvedPhoto, openPhotoLicense } from "../src/providers/photo-policy";

const image = {
  url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Venue.jpg",
  source: "https://commons.wikimedia.org/wiki/File:Venue.jpg",
  credit: "Venue photographer",
  license: "CC BY-SA 4.0",
};
const checkedAt = "2026-10-09T00:00:00Z";

it("accepts only explicit reusable licenses and retains checked evidence", () => {
  for (const license of [
    "CC0",
    "CC0 1.0",
    "CC BY 4.0",
    "CC BY-SA 2.0",
    "Public domain",
  ])
    expect(openPhotoLicense(license)).toBe(true);
  for (const license of [
    "See source licence",
    "CC BY-NC 4.0",
    "CC BY-ND 4.0",
    "Venue website — rights reserved",
  ])
    expect(openPhotoLicense(license)).toBe(false);
  expect(approvedPhoto(image)).toBeUndefined();
  expect(approvedPhoto(image, checkedAt)).toMatchObject({
    rights: "open",
    checkedAt,
    source: image.source,
  });
});

it("does not turn attribution or a permissioned label into permission", () => {
  const reserved = {
    ...image,
    license: "Venue website — rights reserved",
    rights: "permissioned" as const,
    checkedAt,
  };
  expect(approvedPhoto(reserved)).toBeUndefined();
  expect(approvedPhoto(reserved, checkedAt, true)).toBeUndefined();
  const permissioned = {
    ...reserved,
    permission: {
      evidenceUrl: "https://venue.example/permission",
      grantedAt: checkedAt,
      allowsRedistribution: true as const,
    },
  };
  expect(approvedPhoto(permissioned)).toBeUndefined();
  expect(approvedPhoto(permissioned, checkedAt, true)?.rights).toBe(
    "permissioned",
  );
});

it("rejects arbitrary remote URLs masquerading as open-license source evidence", () => {
  expect(
    approvedPhoto(
      {
        ...image,
        source: "https://commons.wikimedia.org.evil.test/wiki/File:Venue.jpg",
      },
      checkedAt,
    ),
  ).toBeUndefined();
  expect(
    approvedPhoto(
      { ...image, url: "https://stock.example/Venue.jpg" },
      checkedAt,
    ),
  ).toBeUndefined();
});
