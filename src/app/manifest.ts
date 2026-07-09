import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FanFlow - CRM para Creadores",
    short_name: "FanFlow",
    description: "Gestiona conversaciones con fans usando IA",
    start_url: "/conversations",
    display: "standalone",
    background_color: "#030712",
    theme_color: "#4f46e5",
    lang: "es",
    icons: [
      {
        src: "/logo.png",
        sizes: "any",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/logo.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
