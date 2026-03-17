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
import { db } from "@/server/db";
import { seoConfig } from "@/server/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

async function getSeoConfig() {
  try {
    const config = await db.query.seoConfig.findFirst({
      where: eq(seoConfig.id, "global"),
    });
    return config;
  } catch {
    return null;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getSeoConfig();

  const title = seo?.siteTitle ?? "FanFlow - CRM con IA para Creadores de Contenido";
  const description = seo?.siteDescription ?? "Gestiona conversaciones con fans usando inteligencia artificial. Scoring automatico, sugerencias de respuesta, analisis de sentimiento y mas. Empieza gratis.";
  const canonical = seo?.canonicalUrl ?? "https://flowfan.app";

  return {
    title,
    description,
    keywords: seo?.keywords?.split(",").map((k) => k.trim()) ?? ["CRM creadores", "gestion fans", "IA conversacional"],
    openGraph: {
      title: seo?.ogTitle || title,
      description: seo?.ogDescription || description,
      type: "website",
      locale: "es_ES",
      siteName: "FanFlow",
      ...(seo?.ogImageUrl ? { images: [{ url: seo.ogImageUrl }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: seo?.twitterTitle || seo?.ogTitle || title,
      description: seo?.twitterDescription || seo?.ogDescription || description,
      ...(seo?.twitterImageUrl ? { images: [seo.twitterImageUrl] } : seo?.ogImageUrl ? { images: [seo.ogImageUrl] } : {}),
    },
    robots: {
      index: seo?.robotsIndex ?? true,
      follow: seo?.robotsFollow ?? true,
    },
    alternates: {
      canonical,
    },
    ...(seo?.faviconUrl ? { icons: { icon: seo.faviconUrl } } : {}),
  };
}

export default async function Home() {
  const session = await getServerSession(authOptions);

  if (session) {
    redirect("/conversations");
  }

  const seo = await getSeoConfig();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "FanFlow",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: seo?.siteDescription ?? "CRM con inteligencia artificial para creadores de contenido.",
    offers: [
      { "@type": "Offer", price: "0", priceCurrency: "EUR", name: "Free" },
      { "@type": "Offer", price: "14", priceCurrency: "EUR", name: "Starter" },
      { "@type": "Offer", price: "29", priceCurrency: "EUR", name: "Pro" },
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
