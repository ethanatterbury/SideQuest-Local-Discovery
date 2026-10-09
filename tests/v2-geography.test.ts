import { describe, expect, it } from "vitest";
import { cellId, inUK, nearbyCells } from "@/domain/geo-cells";
import { weeklyHours } from "@/domain/opening-hours";

describe("V2 geographic coverage and honest hours", () => {
  it("covers all nations and islands, rejects invalid locations and bounds work", () => {
    for (const c of [{lat:54.6,lng:-5.9}, {lat:60.2,lng:-1.2}, {lat:51.5,lng:-3.2}, {lat:53.5,lng:-2.2}]) {
      expect(inUK(c)).toBe(true);
      expect(nearbyCells(c, 25)).toContain(cellId(c));
      expect(nearbyCells(c, 100).length).toBeLessThan(300);
    }
    expect(nearbyCells({lat:NaN,lng:0},25)).toEqual([]);
    expect(inUK({lat:48,lng:2})).toBe(false);
  });
  it("understands weekly windows and overnight opening without inventing exceptions", () => {
    expect(weeklyHours("Mo-Fr 09:00-17:00")).toEqual([{ days:[1,2,3,4,5],open:540,close:1020 }]);
    expect(weeklyHours("Fr 20:00-02:00")).toEqual([{days:[5],open:1200,close:1440},{days:[6],open:0,close:120}]);
    expect(weeklyHours('Mo-Fr 09:00-17:00; PH off')).toBeUndefined();
    expect(weeklyHours('Mo 25:00-26:00')).toBeUndefined();
  });
});
