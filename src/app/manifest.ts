import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Hamd Foods ERP",
    short_name: "Hamd ERP",
    description: "Secure operations workspace for Hamd Foods manufacturing.",
    start_url: "/login",
    scope: "/",
    display: "standalone",
    background_color: "#f3f5f3",
    theme_color: "#176b45",
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
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
