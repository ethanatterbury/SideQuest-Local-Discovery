import type { StyleSpecification } from "maplibre-gl";
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
