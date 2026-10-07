import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SideQuest — Go somewhere",
    short_name: "SideQuest",
    description:
      "A little context. A few great ideas. Stop scrolling. Go somewhere.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f6f6ef",
    theme_color: "#f6f6ef",
    orientation: "any",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
