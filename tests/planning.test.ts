import { expect, it } from "vitest";
import { fromLondonDateTime, londonDateTime } from "../src/domain/planning";
it("plans in UK local time independently of the viewer timezone", () => {
  expect(fromLondonDateTime("2026-07-02T14:00")).toBe(
    "2026-07-02T13:00:00.000Z",
  );
  expect(fromLondonDateTime("2026-12-02T14:00")).toBe(
    "2026-12-02T14:00:00.000Z",
  );
  expect(londonDateTime("2026-07-02T13:00:00Z")).toBe("2026-07-02T14:00");
  expect(fromLondonDateTime("2026-03-29T01:30")).toBeUndefined();
  expect(fromLondonDateTime("bad input")).toBeUndefined();
});
