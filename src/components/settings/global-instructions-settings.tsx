"use client";

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";

export function GlobalInstructionsSettings() {
  const [instructions, setInstructions] = useState("");
  const [saved, setSaved] = useState(false);

  const [responseLanguage, setResponseLanguage] = useState("es");
  const [analysisLanguage, setAnalysisLanguage] = useState("es");
  const [langSaved, setLangSaved] = useState(false);

  const query = trpc.account.getGlobalInstructions.useQuery();
  const langQuery = trpc.account.getLanguageSettings.useQuery();

  const saveMutation = trpc.account.saveGlobalInstructions.useMutation({
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const saveLangMutation = trpc.account.saveLanguageSettings.useMutation({
    onSuccess: () => {
      setLangSaved(true);
      setTimeout(() => setLangSaved(false), 2000);
    },
  });

  useEffect(() => {
    if (query.data) {
      setInstructions(query.data.globalInstructions);
    }
  }, [query.data]);

  useEffect(() => {
    if (langQuery.data) {
      setResponseLanguage(langQuery.data.responseLanguage);
      setAnalysisLanguage(langQuery.data.analysisLanguage);
    }
  }, [langQuery.data]);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    saveMutation.mutate({ globalInstructions: instructions });
  }

  function handleSaveLanguage(e: React.FormEvent) {
    e.preventDefault();
    saveLangMutation.mutate({ responseLanguage, analysisLanguage });
  }

  const supportedLanguages = langQuery.data?.supportedLanguages ?? [];

  return (
    <div className="space-y-10">
      {/* Language settings */}
      <div>
        <h3 className="mb-1 text-base font-semibold text-white">
          Idioma de la IA
        </h3>
        <p className="mb-6 text-sm text-gray-400">
          Configura en que idioma la IA genera las respuestas y los analisis.
        </p>

        <form onSubmit={handleSaveLanguage} className="max-w-2xl space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-gray-300">
                Idioma de respuestas
              </label>
              <select
                value={responseLanguage}
                onChange={(e) => setResponseLanguage(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
              >
                {supportedLanguages.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                La IA generara sugerencias de respuesta en este idioma
              </p>
            </div>

            <div>
              <label className="mb-1 block text-sm text-gray-300">
                Idioma de analisis
              </label>
              <select
                value={analysisLanguage}
                onChange={(e) => setAnalysisLanguage(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
              >
                {supportedLanguages.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                Resumenes, reportes y analisis se generaran en este idioma
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saveLangMutation.isPending}
              className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saveLangMutation.isPending ? "Guardando..." : "Guardar idioma"}
            </button>
            {langSaved && (
              <span className="text-sm text-green-400">Guardado</span>
            )}
          </div>
        </form>
      </div>

      {/* Divider */}
      <div className="border-t border-gray-800" />

      {/* Global instructions */}
      <div>
        <h3 className="mb-1 text-base font-semibold text-white">
          Instrucciones globales
        </h3>
        <p className="mb-6 text-sm text-gray-400">
          Estas instrucciones se aplicaran a todas las conversaciones,
          independientemente de la plataforma. La IA las tendra en cuenta siempre
          al generar sugerencias de respuesta.
        </p>

        <form onSubmit={handleSave} className="max-w-2xl space-y-5">
          <div>
            <label className="mb-1 block text-sm text-gray-300">
              Instrucciones generales
            </label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={6}
              maxLength={2000}
              placeholder="ej: Siempre intenta llevar la conversacion hacia contenido de pago. Nunca des informacion personal real. Usa emojis con moderacion..."
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-gray-500">
              {instructions.length}/2000 caracteres
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saveMutation.isPending ? "Guardando..." : "Guardar"}
            </button>
            {saved && (
              <span className="text-sm text-green-400">Guardado</span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
