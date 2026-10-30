/** Bound canvas memory without changing the viewport, geography or venue data. */
function pixelRatio(
  width: number,
  height: number,
  preferred: number,
  pixels: number,
) {
  return Math.min(preferred, Math.sqrt(pixels / Math.max(1, width * height)));
}
export const mapPixelRatio = (
  width: number,
  height: number,
  preferred: number,
) => pixelRatio(width, height, preferred, 8_000_000);
export const weatherPixelRatio = (
  width: number,
  height: number,
  preferred: number,
) => pixelRatio(width, height, preferred, 1_000_000);
