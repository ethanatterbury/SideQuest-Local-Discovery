import { expect, it } from "vitest";
import { englandCoverage } from "../scripts/lib/england-coverage.mjs";
import snapshot from "@/providers/data/regional-osm.json";
it("rejects the current local snapshot as an England release", () => {
  const report = englandCoverage(snapshot);
  expect(report.ready).toBe(false);
  expect(report.missingAreas).toContain("Manchester");
  expect(report.englandSource).toBe(false);
});
it("does not accept a renamed small sample as national coverage", () => {
  expect(
    englandCoverage({
      ...snapshot,
      sources: [
        "https://download.geofabrik.de/europe/united-kingdom/england-latest.osm.pbf",
      ],
    }).ready,
  ).toBe(false);
});
