import { expect, it } from "vitest";
import { indexedPhoto, photoIdentity } from "../src/providers/photo-index";
const query = { id: "osm-node-12", name: "Branch Park", lat: 51, lng: -1 };
const image = {
  url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Park.jpg",
  source: "https://commons.wikimedia.org/wiki/File:Park.jpg",
  credit: "Author",
  license: "CC BY-SA 2.0",
};
it("reuses a generated match only for the same venue name and position", () => {
  const entry = {
    query,
    image,
    checkedAt: new Date().toISOString(),
    retryable: false,
  };
  expect(indexedPhoto(query, [entry])?.image).toEqual(image);
  expect(indexedPhoto({ ...query, name: "Other Branch" }, [entry])).toBeNull();
  expect(indexedPhoto({ ...query, lat: 52 }, [entry])).toBeNull();
  expect(photoIdentity(query)).not.toBe(
    photoIdentity({ ...query, commons: "File:Changed.jpg" }),
  );
});
it("never persists a temporary provider failure as a missing venue photo", () => {
  expect(
    indexedPhoto(query, [
      {
        query,
        image: null,
        checkedAt: new Date().toISOString(),
        retryable: true,
      },
    ]),
  ).toBeNull();
  expect(
    indexedPhoto(query, [{ query, image, checkedAt: "2020-01-01T00:00:00Z" }]),
  ).toBeNull();
});
