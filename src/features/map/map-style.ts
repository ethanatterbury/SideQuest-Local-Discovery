import type { StyleSpecification } from "maplibre-gl";
export type Basemap = "landscape" | "street" | "satellite";
/** Public CC BY 4.0 Sentinel mosaic; retain its date and 10m resolution in the UI. */
export const SATELLITE_SOURCE = {
  type: "raster" as const,
  tiles: [
    "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg",
  ],
  tileSize: 256,
  maxzoom: 14,
  attribution:
    'Sentinel-2 cloudless 2016 © <a href="https://maps.eox.at/">EOX</a> (modified Copernicus Sentinel data 2016/2017), <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>',
};
/** Includes Northern Ireland, Scilly, Hebrides, Orkney and Shetland. */
export const UK_MAP_BOUNDS: [[number, number], [number, number]] = [
  [-11, 49.3],
  [3, 61.2],
];
export const OPEN_MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
export function landscapeStyle(style: StyleSpecification): StyleSpecification {
  return {
    ...style,
    name: "SideQuest · British landscape",
    layers: style.layers.map((layer) => {
      const id = layer.id.toLowerCase();
      const paint = { ...layer.paint } as Record<string, unknown>;
      if (layer.type === "background") paint["background-color"] = "#f3f1e7";
      if (layer.type === "fill") {
        if (/water/.test(id)) paint["fill-color"] = "#b7cbd0";
        else if (/park|wood|forest|landcover|grass/.test(id))
          paint["fill-color"] = /wood|forest/.test(id) ? "#c1d0b3" : "#d9e1c7";
        else if (/building/.test(id)) paint["fill-color"] = "#dedbd0";
        else if (/residential|landuse/.test(id))
          paint["fill-color"] = "#eae7dc";
      }
      if (layer.type === "line") {
        if (/water/.test(id)) paint["line-color"] = "#a5c0c8";
        else if (/motorway|trunk/.test(id)) paint["line-color"] = "#c6bc9e";
        else if (/road|transport/.test(id))
          paint["line-color"] = /casing/.test(id) ? "#ddd8c9" : "#ffffff";
        else if (/boundary/.test(id)) paint["line-color"] = "#a5ad9e";
      }
      if (layer.type === "symbol" && layer.layout?.["text-field"]) {
        paint["text-color"] = /water/.test(id) ? "#56737c" : "#526252";
        paint["text-halo-color"] = "#f7f5ed";
        paint["text-halo-width"] = 1.5;
      }
      return { ...layer, paint } as typeof layer;
    }),
  };
}
