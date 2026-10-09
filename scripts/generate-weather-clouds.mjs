import sharp from "sharp";
// Deterministic domain-warped fractal density, lit from the upper left. The
// transparent contour follows the density itself; no geometric cloud masks.
const width = 768,
  height = 512;
const smooth = (x) => x * x * (3 - 2 * x);
const fract = (x) => x - Math.floor(x);
const hash = (x, y) =>
  fract(Math.sin(x * 127.1 + y * 311.7 + 47.2) * 43758.5453);
function noise(x, y) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    tx = smooth(fract(x)),
    ty = smooth(fract(y));
  const a = hash(ix, iy),
    b = hash(ix + 1, iy),
    c = hash(ix, iy + 1),
    d = hash(ix + 1, iy + 1);
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}
function fbm(x, y, octaves = 6) {
  let total = 0,
    weight = 0.5,
    normal = 0;
  for (let o = 0; o < octaves; o++) {
    total += noise(x, y) * weight;
    normal += weight;
    x = x * 2.03 + 13.1;
    y = y * 2.01 + 7.4;
    weight *= 0.52;
  }
  return total / normal;
}
const density = new Float32Array(width * height);
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++) {
    const u = (x / width) * 4.8,
      v = (y / height) * 4.5;
    const warpX = fbm(u + 0.8, v + 4.6, 4),
      warpY = fbm(u + 6.7, v + 9.2, 4);
    const field = fbm(u + warpX * 1.9, v + warpY * 1.9);
    density[y * width + x] = Math.max(0, Math.min(1, (field - 0.35) / 0.28));
  }
const image = Buffer.alloc(width * height * 4),
  shadow = Buffer.alloc(width * height * 4);
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++) {
    const i = y * width + x,
      d = density[i],
      edge = smooth(d);
    const above = density[Math.max(0, y - 11) * width + Math.max(0, x - 7)];
    const light = Math.max(
      0,
      Math.min(1, 0.54 + (d - above) * 1.5 + 0.12 * (1 - y / height)),
    );
    const shade = 0.35 + light * 0.65;
    image[i * 4] = Math.round(73 + shade * 180);
    image[i * 4 + 1] = Math.round(95 + shade * 157);
    image[i * 4 + 2] = Math.round(109 + shade * 138);
    image[i * 4 + 3] = Math.round(edge * 220);
    shadow[i * 4] = 37;
    shadow[i * 4 + 1] = 62;
    shadow[i * 4 + 2] = 77;
    shadow[i * 4 + 3] = Math.round(edge * 205);
  }
await sharp(image, { raw: { width, height, channels: 4 } })
  .webp({ quality: 90, alphaQuality: 95 })
  .toFile("public/weather/cloud-density.webp");
await sharp(shadow, { raw: { width, height, channels: 4 } })
  .webp({ quality: 82, alphaQuality: 90 })
  .toFile("public/weather/cloud-shadow.webp");
