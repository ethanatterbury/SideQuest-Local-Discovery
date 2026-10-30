import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/*": ["./node_modules/next/dist/lib/framework/*.js"],
  },
  outputFileTracingExcludes: {
    "/*": [
      "./public/data/venues/**",
      "./src/providers/data/regions/**",
      "./src/providers/data/regional-osm.json",
      "./src/providers/data/geograph-venue-matches.json.gz",
      "./src/providers/data/venue-media-assets/**",
      "./work/**",
    ],
  },
  images: {
    // Approved sources already host these images; avoid Vercel transforms/cache copies.
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "upload.wikimedia.org",
        pathname: "/wikipedia/commons/**",
        search: "",
      },
      {
        protocol: "https",
        hostname: "archive.org",
        port: "",
        pathname: "/download/**",
        search: "",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(self)",
          },
        ],
      },
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
      {
        source: "/venue-images/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};
export default config;
