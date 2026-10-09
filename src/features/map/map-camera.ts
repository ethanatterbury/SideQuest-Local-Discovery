export type MapCamera = {
  x: number;
  y: number;
  scale: number;
  width: number;
  height: number;
  /** Visible water polygons in CSS pixels. Rings preserve holes via even-odd fill. */
  water: [number, number][][][];
};
