import type { OpeningWindow } from "./models";

const days = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
/** Parse only unambiguous weekly schedules. Conditional/holiday rules stay unknown. */
export function weeklyHours(raw: string): OpeningWindow[] | undefined {
  if (raw === "24/7") return [{ days: [0, 1, 2, 3, 4, 5, 6], open: 0, close: 1440 }];
  if (!raw || /PH|SH|sunrise|sunset|\+|"|\(|\bweek\b|\bJan\b/i.test(raw)) return undefined;
  const result: OpeningWindow[] = [];
  for (const rule of raw.split(";")) {
    const match = /^\s*((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su))*)\s+(.+)\s*$/.exec(rule);
    if (!match) return undefined;
    const selected = new Set<number>();
    for (const range of match[1].split(",")) {
      const [a, b = a] = range.split("-").map((day) => days.indexOf(day));
      for (let i = a; ; i = (i + 1) % 7) { selected.add(i); if (i === b) break; }
    }
    if (match[2].trim() === "off" || match[2].trim() === "closed") continue;
    for (const interval of match[2].trim().split(",")) {
      const time = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(interval.trim());
      if (!time) return undefined;
      const [, ah, am, bh, bm] = time.map(Number);
      if (ah > 23 || bh > 24 || am > 59 || bm > 59 || (bh === 24 && bm !== 0)) return undefined;
      const open = ah * 60 + am, close = bh * 60 + bm;
      if (open === close) return undefined;
      if (close > open) result.push({ days: [...selected], open, close });
      else {
        result.push({ days: [...selected], open, close: 1440 });
        result.push({ days: [...selected].map((d) => (d + 1) % 7), open: 0, close });
      }
    }
  }
  return result.length ? result : undefined;
}
