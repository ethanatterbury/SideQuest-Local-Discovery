import type { Place } from "@/domain/models";

const MAX_AREAS = 24;
type Area = { id: string; at: number; places: Place[] };
function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    try {
      const request = indexedDB.open("sidequest-areas-v2", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("areas", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}
export async function readArea(id: string): Promise<Area | null> {
  const db = await openDatabase();
  if (!db) return null;
  return new Promise(resolve => {
    const tx = db.transaction("areas", "readonly");
    const req = tx.objectStore("areas").get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
    tx.oncomplete = tx.onabort = () => db.close();
  });
}
export async function writeArea(id: string, places: Place[]): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  const tx = db.transaction("areas", "readwrite"), store = tx.objectStore("areas");
  store.put({ id, at: Date.now(), places: places.slice(0, 600) });
  const req = store.getAll();
  req.onsuccess = () => {
    const areas = (req.result as Area[]).sort((a, b) => b.at - a.at);
    for (const area of areas.slice(MAX_AREAS)) store.delete(area.id);
  };
  tx.oncomplete = tx.onabort = () => db.close();
}
