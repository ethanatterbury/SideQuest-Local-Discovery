export function londonParts(date: string) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(date));
  const value = (t: string) => p.find((x) => x.type === t)?.value || "";
  return {
    day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      value("weekday"),
    ),
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
  };
}
export function formatTime(date: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}
export function durationLabel(minutes: number) {
  return minutes < 60
    ? `${minutes} min`
    : `${Math.floor(minutes / 60)}${minutes % 60 ? "½" : ""} hr${minutes >= 120 ? "s" : ""}`;
}
export function addMinutes(date: string, minutes: number) {
  return new Date(new Date(date).getTime() + minutes * 60000).toISOString();
}
export function isDark(now: string, sunrise: string, sunset: string) {
  const n = new Date(now).getTime();
  return n < new Date(sunrise).getTime() || n >= new Date(sunset).getTime();
}

/** Solar phases follow the provider's sun times, including short winter days. */
export function solarPhase(now: string, sunrise: string, sunset: string) {
  const n = new Date(now).getTime();
  const rise = new Date(sunrise).getTime();
  const set = new Date(sunset).getTime();
  const minute = 60000;
  if (n >= rise - 25 * minute && n < rise + 40 * minute) return "sunrise";
  if (n >= set - 25 * minute && n < set + 25 * minute) return "sunset";
  if (n < rise || n >= set + 180 * minute) return "midnight";
  if (n >= set) return "evening";
  if (n >= set - 90 * minute) return "golden-hour";
  if (n < (rise + set) / 2 - 60 * minute) return "morning";
  return "midday";
}

export function solarPreset(
  kind: Exclude<import("./models").TimeKind, "live">,
  now: string,
  sunrise: string,
  sunset: string,
) {
  const rise = new Date(sunrise).getTime();
  const set = new Date(sunset).getTime();
  const daylight = set - rise;
  const presets = {
    sunrise: rise,
    morning: rise + Math.max(60 * 60000, daylight * 0.24),
    midday: (rise + set) / 2,
    "golden-hour": set - 60 * 60000,
    sunset: set,
    evening: set + 90 * 60000,
    midnight: new Date(now).getTime() - londonParts(now).minutes * 60000,
  };
  return new Date(presets[kind]).toISOString();
}
