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
    // Iconos cuadrados reales (antes se declaraba logo.png de 1024x660 como
    // 512x512, y Android/Chrome lo rechazaban o lo deformaban).
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
