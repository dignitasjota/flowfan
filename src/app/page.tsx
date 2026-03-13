import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/server/auth";
import { Hero } from "@/components/landing/hero";
import { Features } from "@/components/landing/features";
import { PricingTable } from "@/components/landing/pricing-table";
import { FAQ } from "@/components/landing/faq";
import { Footer } from "@/components/landing/footer";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FanFlow - CRM con IA para Creadores de Contenido",
  description:
    "Gestiona conversaciones con fans usando inteligencia artificial. Scoring automatico, sugerencias de respuesta, analisis de sentimiento y mas. Empieza gratis.",
  keywords: [
    "CRM creadores",
    "gestion fans",
    "IA conversacional",
    "OnlyFans CRM",
    "asistente IA",
    "scoring fans",
    "creadores de contenido",
  ],
  openGraph: {
    title: "FanFlow - CRM con IA para Creadores de Contenido",
    description:
      "Gestiona conversaciones con fans usando inteligencia artificial. Scoring automatico, sugerencias de respuesta y mas.",
    type: "website",
    locale: "es_ES",
    siteName: "FanFlow",
  },
  twitter: {
    card: "summary_large_image",
    title: "FanFlow - CRM con IA para Creadores",
    description:
      "Gestiona conversaciones con fans usando inteligencia artificial. Empieza gratis.",
  },
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: "/",
  },
};

export default async function Home() {
  const session = await getServerSession(authOptions);

  if (session) {
    redirect("/conversations");
  }

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "FanFlow",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description:
      "CRM con inteligencia artificial para creadores de contenido. Gestiona conversaciones con fans, scoring automatico y sugerencias de respuesta.",
    offers: [
      {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        name: "Free",
      },
      {
        "@type": "Offer",
        price: "15",
        priceCurrency: "USD",
        name: "Starter",
      },
      {
        "@type": "Offer",
        price: "29",
        priceCurrency: "USD",
        name: "Pro",
      },
    ],
  };

  return (
    <div className="min-h-screen bg-gray-950">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* Navbar */}
      <nav className="sticky top-0 z-50 border-b border-gray-800/50 bg-gray-950/80 backdrop-blur-lg">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="text-xl font-bold text-white">FanFlow</span>
          <div className="flex items-center gap-4">
            <Link
              href="/login"
              className="text-sm font-medium text-gray-300 hover:text-white transition-colors"
            >
              Iniciar sesion
            </Link>
            <Link
              href="/register"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
            >
              Empieza gratis
            </Link>
          </div>
        </div>
      </nav>

      <Hero />
      <Features />
      <PricingTable isLanding />
      <FAQ />
      <Footer />
    </div>
  );
}
