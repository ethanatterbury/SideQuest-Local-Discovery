export type OutingPlan = {
  at?: string;
  weather?: import("./models").WeatherKind;
};
/** datetime-local describes UK wall time, even when the device is abroad. */
export function londonDateTime(iso: string): string {
  const values = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const part = (type: string) => values.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
export function fromLondonDateTime(value: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return;
  const wall = Date.parse(value + ":00Z");
  if (!Number.isFinite(wall)) return;
  for (const offset of [0, 3600000]) {
    const iso = new Date(wall - offset).toISOString();
    if (londonDateTime(iso) === value) return iso;
  }
}
