"use client";

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";

export default function AdminSeoPage() {
  const query = trpc.admin.getSeoConfig.useQuery();
  const updateMutation = trpc.admin.updateSeoConfig.useMutation({
    onSuccess: () => setSaved(true),
    onError: (e) => setError(e.message),
  });

  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    siteTitle: "",
    siteDescription: "",
    keywords: "",
    canonicalUrl: "",
    ogTitle: "",
    ogDescription: "",
    ogImageUrl: "",
    twitterTitle: "",
    twitterDescription: "",
    twitterImageUrl: "",
    faviconUrl: "",
    robotsIndex: true,
    robotsFollow: true,
  });

  useEffect(() => {
    if (query.data) {
      setForm({
        siteTitle: query.data.siteTitle ?? "",
        siteDescription: query.data.siteDescription ?? "",
        keywords: query.data.keywords ?? "",
        canonicalUrl: query.data.canonicalUrl ?? "",
        ogTitle: query.data.ogTitle ?? "",
        ogDescription: query.data.ogDescription ?? "",
        ogImageUrl: query.data.ogImageUrl ?? "",
        twitterTitle: query.data.twitterTitle ?? "",
        twitterDescription: query.data.twitterDescription ?? "",
        twitterImageUrl: query.data.twitterImageUrl ?? "",
        faviconUrl: query.data.faviconUrl ?? "",
        robotsIndex: query.data.robotsIndex ?? true,
        robotsFollow: query.data.robotsFollow ?? true,
      });
    }
  }, [query.data]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    setSaved(false);
    setError(null);
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  function handleCheckbox(name: string, value: boolean) {
    setSaved(false);
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    setError(null);
    updateMutation.mutate(form);
  }

  const inputClass = "w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none";
  const labelClass = "mb-1 block text-xs font-medium text-gray-400";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="text-2xl font-bold text-white">SEO & Metadatos</h1>
        <p className="mt-1 text-sm text-gray-400">
          Configura los metadatos SEO de la landing page pública.
        </p>

        {query.isLoading ? (
          <div className="mt-8 space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-800" />
            ))}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-8 space-y-8">
            {/* General */}
            <section className="rounded-xl border border-gray-800 bg-gray-900 p-6">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-400">General</h2>
              <div className="space-y-4">
                <div>
                  <label className={labelClass}>Título del sitio</label>
                  <input name="siteTitle" value={form.siteTitle} onChange={handleChange} className={inputClass} placeholder="FanFlow - CRM con IA para Creadores" />
                  <p className="mt-1 text-xs text-gray-600">{form.siteTitle.length}/255 caracteres</p>
                </div>
                <div>
                  <label className={labelClass}>Meta description</label>
                  <textarea name="siteDescription" value={form.siteDescription} onChange={handleChange} rows={3} className={inputClass} placeholder="Descripción para motores de búsqueda..." />
                  <p className="mt-1 text-xs text-gray-600">{form.siteDescription.length} caracteres (recomendado: 150-160)</p>
                </div>
                <div>
                  <label className={labelClass}>Keywords (separadas por coma)</label>
                  <input name="keywords" value={form.keywords} onChange={handleChange} className={inputClass} placeholder="CRM creadores, IA conversacional, OnlyFans CRM..." />
                </div>
                <div>
                  <label className={labelClass}>URL canónica</label>
                  <input name="canonicalUrl" value={form.canonicalUrl} onChange={handleChange} className={inputClass} placeholder="https://flowfan.app" />
                </div>
                <div>
                  <label className={labelClass}>URL del favicon</label>
                  <input name="faviconUrl" value={form.faviconUrl} onChange={handleChange} className={inputClass} placeholder="https://flowfan.app/favicon.ico" />
                </div>
              </div>
            </section>

            {/* Open Graph */}
            <section className="rounded-xl border border-gray-800 bg-gray-900 p-6">
              <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-gray-400">Open Graph (redes sociales)</h2>
              <p className="mb-4 text-xs text-gray-600">Si se deja vacío, se usan el título y descripción generales.</p>
              <div className="space-y-4">
                <div>
                  <label className={labelClass}>OG Title</label>
                  <input name="ogTitle" value={form.ogTitle} onChange={handleChange} className={inputClass} placeholder="Título para redes sociales..." />
                </div>
                <div>
                  <label className={labelClass}>OG Description</label>
                  <textarea name="ogDescription" value={form.ogDescription} onChange={handleChange} rows={2} className={inputClass} placeholder="Descripción para compartir en redes..." />
                </div>
                <div>
                  <label className={labelClass}>OG Image URL</label>
                  <input name="ogImageUrl" value={form.ogImageUrl} onChange={handleChange} className={inputClass} placeholder="https://flowfan.app/og-image.png" />
                  <p className="mt-1 text-xs text-gray-600">Recomendado: 1200×630px</p>
                </div>
              </div>
            </section>

            {/* Twitter Card */}
            <section className="rounded-xl border border-gray-800 bg-gray-900 p-6">
              <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-gray-400">Twitter / X Card</h2>
              <p className="mb-4 text-xs text-gray-600">Si se deja vacío, se usan los valores de Open Graph.</p>
              <div className="space-y-4">
                <div>
                  <label className={labelClass}>Twitter Title</label>
                  <input name="twitterTitle" value={form.twitterTitle} onChange={handleChange} className={inputClass} placeholder="Título para Twitter/X..." />
                </div>
                <div>
                  <label className={labelClass}>Twitter Description</label>
                  <textarea name="twitterDescription" value={form.twitterDescription} onChange={handleChange} rows={2} className={inputClass} placeholder="Descripción para Twitter/X..." />
                </div>
                <div>
                  <label className={labelClass}>Twitter Image URL</label>
                  <input name="twitterImageUrl" value={form.twitterImageUrl} onChange={handleChange} className={inputClass} placeholder="https://flowfan.app/twitter-image.png" />
                </div>
              </div>
            </section>

            {/* Robots */}
            <section className="rounded-xl border border-gray-800 bg-gray-900 p-6">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-400">Robots & Indexación</h2>
              <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.robotsIndex}
                    onChange={(e) => handleCheckbox("robotsIndex", e.target.checked)}
                    className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div>
                    <p className="text-sm font-medium text-white">Permitir indexación (index)</p>
                    <p className="text-xs text-gray-500">Los motores de búsqueda pueden indexar el sitio</p>
                  </div>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.robotsFollow}
                    onChange={(e) => handleCheckbox("robotsFollow", e.target.checked)}
                    className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div>
                    <p className="text-sm font-medium text-white">Permitir seguir enlaces (follow)</p>
                    <p className="text-xs text-gray-500">Los motores de búsqueda pueden rastrear los enlaces</p>
                  </div>
                </label>
              </div>
            </section>

            {/* Save */}
            <div className="flex items-center justify-between">
              {saved && <p className="text-sm text-green-400">✓ Cambios guardados</p>}
              {error && <p className="text-sm text-red-400">{error}</p>}
              {!saved && !error && <span />}
              <button
                type="submit"
                disabled={updateMutation.isPending}
                className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {updateMutation.isPending ? "Guardando..." : "Guardar cambios"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
