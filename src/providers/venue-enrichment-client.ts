import type { Place } from "@/domain/models";
/** A session queue keeps metadata work out of rendering and never runs more than two lookups. */
export function createVenueEnrichmentQueue(transport: typeof fetch = fetch) {
  const checked = new Map<string, number>();
  const pending = new Map<string, Promise<void>>();
  const waiting: (() => void)[] = [];
  const controllers = new Set<AbortController>();
  let active = 0,
    stopped = false;
  const pump = () => {
    while (!stopped && active < 2 && waiting.length) waiting.shift()!();
  };
  const request = (id: string, accept: (place: Place) => void) => {
    if (
      stopped ||
      !/^osm-(?:node|way|relation)-[1-9]\d{0,15}$/.test(id) ||
      (checked.get(id) ?? 0) > Date.now()
    )
      return Promise.resolve();
    const existing = pending.get(id);
    if (existing) return existing;
    const task = new Promise<void>((resolve) => {
      waiting.push(() => {
        active++;
        const controller = new AbortController();
        controllers.add(controller);
        void (async () => {
          try {
            const response = await transport(
              `/api/venue-evidence?id=${encodeURIComponent(id)}`,
              {
                signal: AbortSignal.any([
                  controller.signal,
                  AbortSignal.timeout(16000),
                ]),
              },
            );
            if (!response.ok) throw new Error("Venue evidence unavailable");
            const result = await response.json();
            const place = result.place as Place | null;
            checked.set(
              id,
              Date.now() +
                (["unavailable", "disabled"].includes(result.status)
                  ? 60000
                  : result.status === "verified"
                    ? 86400000
                    : 3600000),
            );
            if (
              !stopped &&
              result.status === "verified" &&
              place?.id === id &&
              typeof place.name === "string" &&
              typeof place.category === "string" &&
              Number.isFinite(place.coordinates?.lat) &&
              Number.isFinite(place.coordinates?.lng) &&
              place.experiences?.some(
                (record) =>
                  record.primary &&
                  record.evidence.source === "official" &&
                  record.evidence.confidence === "verified",
              )
            )
              accept(place);
          } catch {
            if (!controller.signal.aborted) checked.set(id, Date.now() + 60000);
          } finally {
            controllers.delete(controller);
            active--;
            pending.delete(id);
            if (checked.size > 1000)
              checked.delete(checked.keys().next().value!);
            resolve();
            pump();
          }
        })();
      });
    });
    pending.set(id, task);
    pump();
    return task;
  };
  return {
    enqueue: (ids: string[], accept: (place: Place) => void) =>
      Promise.all(ids.map((id) => request(id, accept))).then(() => {}),
    dispose: () => {
      stopped = true;
      controllers.forEach((controller) => controller.abort());
    },
  };
}
