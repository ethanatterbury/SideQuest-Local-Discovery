import { expect, it } from "vitest";
import {
  rejectedPhotoSource,
  rejectedPhotoSources,
} from "../src/providers/rejected-photo-sources";

const source =
  "https://archive.org/details/windsor-2018-09-15/Windsor%202018-09-15/DSCN7610.JPG";

it("records the exact reviewed wrong-business source and review reason", () => {
  expect(rejectedPhotoSources).toEqual([
    {
      source,
      reason: "different-business",
      reviewedAt: "2026-10-29",
      description:
        "Shows Café Copia, a different business at the premises, rather than Dr Chocs.",
    },
  ]);
  expect(rejectedPhotoSource(source)).toBe(true);
});

it.each([
  source.replace("%20", " "),
  source.replace("Windsor%20", "%57indsor%20"),
  `${source}?download=1&utm_source=sidequest#photo`,
  source.replace("/details/", "/download/"),
  source.replace("https://archive.org", "http://ARCHIVE.ORG"),
])("rejects an equivalent rendition/source encoding %s", (variant) => {
  expect(rejectedPhotoSource(variant)).toBe(true);
});

it.each([
  source.replace("DSCN7610", "DSCN7608"),
  source.replace("windsor-2018-09-15/", "windsor-2026-09-15/"),
  source.replace("DSCN7610.JPG", "DSCN7610.jpg"),
  source.replace("Windsor%20", "Windsor_"),
  source.replace("Windsor%20", "Windsor%2520"),
  source.replace("/Windsor%20", "%2FWindsor%20"),
  "https://archive.org/details/windsor-2018-09-15",
  "https://drchocs.com/current-interior.jpg",
  "https://commons.wikimedia.org/wiki/File:The_Look_Out_car_park_-_geograph.org.uk_-_3117925.jpg",
  "https://commons.wikimedia.org/wiki/File:Blunden_Hall_Community_Centre_-_geograph.org.uk_-_7359660.jpg",
  "https://commons.wikimedia.org/wiki/File:Dr_Chocs_current_shop.jpg",
])("does not exclude another source file or its venue %s", (other) => {
  expect(rejectedPhotoSource(other)).toBe(false);
});

it.each([
  source.replace("archive.org", "archive.org.evil.test"),
  source.replace("archive.org", "archive.org@evil.test"),
  source.replace("archive.org", "user@archive.org"),
  source.replace("archive.org", "archive.org:8443"),
  source.replace("https:", "ftp:"),
  source.replace("%20", "%zz"),
  "Dr Chocs",
  "",
])(
  "does not confuse an invalid or unrelated URL with the source %s",
  (other) => {
    expect(rejectedPhotoSource(other)).toBe(false);
  },
);
