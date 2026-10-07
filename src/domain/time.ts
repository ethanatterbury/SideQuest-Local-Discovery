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
