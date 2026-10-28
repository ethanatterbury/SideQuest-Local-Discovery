import { expect, it } from "vitest";
import { createVenueEnrichmentQueue } from "@/providers/venue-enrichment-client";
import { PLACES } from "@/providers/places";

it("queues at most two requests, reuses checked ids, and accepts only matching verified responses", async () => {
  let active = 0,
    maximum = 0,
    calls = 0;
  const received: string[] = [];
  const queue = createVenueEnrichmentQueue(async (url) => {
    calls++;
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    const id = new URL(String(url), "https://sidequest.test").searchParams.get(
      "id",
    )!;
    return Response.json({
      status: "verified",
      place: {
        ...PLACES[0],
        experiences: [
          {
            primary: true,
            activities: ["soft-play"],
            evidence: {
              source: "official",
              confidence: "verified",
              url: "https://acorn-oak.co.uk/",
            },
          },
        ],
        id: id.endsWith("3") ? "osm-node-999" : id,
      },
    });
  });
  const ids = ["osm-way-1", "osm-way-2", "osm-way-3"];
  await queue.enqueue(ids, (place) => received.push(place.id));
  await queue.enqueue(ids, (place) => received.push(place.id));
  expect(maximum).toBe(2);
  expect(calls).toBe(3);
  expect(received).toEqual(["osm-way-1", "osm-way-2"]);
  queue.dispose();
});
