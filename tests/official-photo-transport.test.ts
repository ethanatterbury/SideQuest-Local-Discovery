import { EventEmitter } from "node:events";
import type { IncomingMessage, RequestOptions } from "node:http";
import { Readable } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("node:https", () => ({ request: mocks.request }));
import {
  downloadOfficialPhoto,
  resolveOfficialPhotos,
} from "../src/providers/official-photo";

afterEach(() => mocks.request.mockReset());
function serverResponse(
  bytes: Uint8Array,
  statusCode = 200,
  type = "text/html",
) {
  mocks.request.mockImplementation(
    (
      _url: URL,
      _options: RequestOptions,
      callback: (response: IncomingMessage) => void,
    ) => {
      const response = Object.assign(Readable.from([bytes]), {
        statusCode,
        headers: { "content-type": type },
      });
      return Object.assign(new EventEmitter(), {
        end: () => callback(response as IncomingMessage),
      });
    },
  );
}

it("pins node:https lookup to already-verified public DNS answers and disables connection pooling", async () => {
  serverResponse(
    Buffer.from(
      '<title>Pirates Landing Wokingham</title><img class="gallery" src="/building.jpg">',
    ),
  );
  const lookup = vi.fn(async () => [
    { address: "8.8.8.8", family: 4 },
    { address: "2606:4700::1111", family: 6 },
  ]);
  const result = await resolveOfficialPhotos(
    {
      name: "Pirates Landing",
      area: "Wokingham",
      lat: 51.41,
      lng: -0.84,
      website: "https://venue.co.uk/",
    },
    { lookup },
  );
  expect(result.candidates).toHaveLength(1);
  const options = mocks.request.mock.calls[0][1];
  expect(options.agent).toBe(false);
  expect(options.headers["Accept-Encoding"]).toBe("identity");
  const single = vi.fn(),
    all = vi.fn();
  const before = lookup.mock.calls.length;
  options.lookup("venue.co.uk", { all: false }, single);
  options.lookup("venue.co.uk", { all: true }, all);
  expect(single).toHaveBeenCalledWith(null, "8.8.8.8", 4);
  expect(all).toHaveBeenCalledWith(null, [
    { address: "8.8.8.8", family: 4 },
    { address: "2606:4700::1111", family: 6 },
  ]);
  expect(lookup).toHaveBeenCalledTimes(before);
});

it("handles status codes that cannot contain Response bodies without throwing from the network callback", async () => {
  serverResponse(Buffer.alloc(0), 204);
  const result = await resolveOfficialPhotos(
    {
      name: "Pirates Landing",
      lat: 51.41,
      lng: -0.84,
      website: "https://venue.co.uk/",
    },
    { lookup: async () => [{ address: "8.8.8.8", family: 4 }] },
  );
  expect(result.reason).toBe("unconfirmed-venue-or-branch");
});

it("uses the same pinned transport for image downloads with image-specific Accept headers", async () => {
  serverResponse(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 200, "image/jpeg");
  const result = await downloadOfficialPhoto(
    "https://cdn.venue.co.uk/building.jpg",
    { lookup: async () => [{ address: "8.8.8.8", family: 4 }] },
  );
  expect(result?.buffer.length).toBe(4);
  expect(mocks.request.mock.calls[0][1].headers.Accept).toContain("image/jpeg");
});
