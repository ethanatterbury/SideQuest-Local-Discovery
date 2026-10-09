import { describe, expect, it } from "vitest";
import { landscapeStyle, UK_MAP_BOUNDS } from "../src/features/map/map-style";
import type { StyleSpecification } from "maplibre-gl";
describe("British landscape map", () => {
  it("covers Northern Ireland and the northern and southern islands", () => {
    for (const [lng, lat] of [
      [-6.7, 54.6],
      [-6.3, 49.9],
      [-7.5, 57.7],
      [-1.2, 60.7],
    ]) {
      expect(lng).toBeGreaterThan(UK_MAP_BOUNDS[0][0]);
      expect(lng).toBeLessThan(UK_MAP_BOUNDS[1][0]);
      expect(lat).toBeGreaterThan(UK_MAP_BOUNDS[0][1]);
      expect(lat).toBeLessThan(UK_MAP_BOUNDS[1][1]);
    }
  });
  it("restyles geography while preserving source, labels and zoom contracts", () => {
    const input: StyleSpecification = {
      version: 8,
      sources: { world: { type: "vector", url: "https://example.test/world" } },
      layers: [
        {
          id: "water",
          type: "fill",
          source: "world",
          "source-layer": "water",
          minzoom: 4,
          paint: { "fill-color": "blue" },
        },
        {
          id: "place-label",
          type: "symbol",
          source: "world",
          "source-layer": "place",
          layout: { "text-field": ["get", "name"] },
        },
      ],
    };
    const output = landscapeStyle(input);
    expect(output.sources).toEqual(input.sources);
    expect(output.layers[0]).toMatchObject({
      minzoom: 4,
      "source-layer": "water",
      paint: { "fill-color": "#b7cbd0" },
    });
    expect(output.layers[1].layout).toEqual(input.layers[1].layout);
    expect(input.layers[0].paint).toEqual({ "fill-color": "blue" });
  });
});
