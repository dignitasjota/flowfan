"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { PLATFORM_OPTIONS } from "@/lib/constants";

const platformOptionsWithAll = [
  { value: "", label: "Todas las plataformas" },
  ...PLATFORM_OPTIONS,
];

export function TemplateSettings() {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("");
  const [platformType, setPlatformType] = useState("");
  const [variablesText, setVariablesText] = useState("");

  const utils = trpc.useUtils();
  const { data: templates, isLoading } = trpc.templates.list.useQuery({});
  const { data: categories } = trpc.templates.getCategories.useQuery();
  const createTemplate = trpc.templates.create.useMutation({
    onSuccess: () => {
      utils.templates.list.invalidate();
      utils.templates.getCategories.invalidate();
      resetForm();
    },
  });
  const updateTemplate = trpc.templates.update.useMutation({
    onSuccess: () => {
      utils.templates.list.invalidate();
      utils.templates.getCategories.invalidate();
      resetForm();
    },
  });
  const deleteTemplate = trpc.templates.delete.useMutation({
    onSuccess: () => {
      utils.templates.list.invalidate();
      utils.templates.getCategories.invalidate();
    },
  });

  function resetForm() {
    setShowForm(false);
    setEditingId(null);
    setName("");
    setContent("");
    setCategory("");
    setPlatformType("");
    setVariablesText("");
  }

  function handleEdit(template: NonNullable<typeof templates>[number]) {
    setEditingId(template.id);
    setName(template.name);
    setContent(template.content);
    setCategory(template.category ?? "");
    setPlatformType(template.platformType ?? "");
    setVariablesText((template.variables ?? []).join(", "));
    setShowForm(true);
  }

  function handleSave() {
    const variables = variablesText
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    if (editingId) {
      updateTemplate.mutate({
        id: editingId,
        name,
        content,
        category: category || undefined,
        platformType: platformType || undefined,
        variables,
      });
    } else {
      createTemplate.mutate({
        name,
        content,
        category: category || undefined,
        platformType: platformType || undefined,
        variables,
      });
    }
  }

  // Replace variables in content for preview
  function previewContent(text: string): string {
    return text
      .replace(/\{username\}/g, "@ejemplo_user")
      .replace(/\{platform\}/g, "Instagram")
      .replace(/\{price\}/g, "$25")
      .replace(/\{link\}/g, "https://ejemplo.com");
  }

  if (isLoading) {
    return <p className="text-gray-500">Cargando templates...</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Templates de respuesta</h3>
          <p className="text-xs text-gray-400">
            Crea mensajes predefinidos con variables dinamicas
          </p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Nuevo template
          </button>
        )}
      </div>

      {/* Variables help */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-3">
        <p className="text-xs font-medium text-gray-400">Variables disponibles:</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {["{username}", "{platform}", "{price}", "{link}"].map((v) => (
            <code
              key={v}
              className="rounded bg-gray-700 px-1.5 py-0.5 text-xs text-indigo-300"
            >
              {v}
            </code>
          ))}
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div className="space-y-4 rounded-lg border border-gray-700 bg-gray-800/50 p-4">
          <h4 className="text-sm font-medium text-white">
            {editingId ? "Editar template" : "Nuevo template"}
          </h4>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-400">
                Nombre
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Saludo inicial"
                className="w-full rounded-lg border border-gray-600 bg-gray-700 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-400">
                Categoria
              </label>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Ej: Saludos, Ofertas, Cierre"
                list="categories"
                className="w-full rounded-lg border border-gray-600 bg-gray-700 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
              />
              <datalist id="categories">
                {categories?.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">
              Plataforma (opcional)
            </label>
            <select
              value={platformType}
              onChange={(e) => setPlatformType(e.target.value)}
              className="w-full rounded-lg border border-gray-600 bg-gray-700 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
            >
              {platformOptionsWithAll.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">
              Contenido del mensaje
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Hola {username}! Gracias por escribirme en {platform}..."
              rows={4}
              className="w-full rounded-lg border border-gray-600 bg-gray-700 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
            />
            {content && (
              <div className="mt-2 rounded bg-gray-900/50 p-2">
                <span className="text-[10px] uppercase text-gray-500">Vista previa:</span>
                <p className="mt-1 text-xs text-gray-300">{previewContent(content)}</p>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={!name.trim() || !content.trim() || createTemplate.isPending || updateTemplate.isPending}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {createTemplate.isPending || updateTemplate.isPending ? "Guardando..." : editingId ? "Actualizar" : "Crear"}
            </button>
            <button
              onClick={resetForm}
              className="rounded-lg border border-gray-600 px-4 py-2 text-sm text-gray-400 hover:text-white"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Template List */}
      {templates && templates.length > 0 ? (
        <div className="space-y-2">
          {templates.map((template) => (
            <div
              key={template.id}
              className="rounded-lg border border-gray-700 bg-gray-800/50 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-medium text-white">{template.name}</h4>
                    {template.category && (
                      <span className="rounded-full bg-gray-700 px-2 py-0.5 text-[10px] text-gray-300">
                        {template.category}
                      </span>
                    )}
                    {template.platformType && (
                      <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] text-indigo-300">
                        {template.platformType}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-gray-400 line-clamp-2">{template.content}</p>
                  <p className="mt-1 text-[10px] text-gray-600">
                    Usado {template.usageCount} veces
                  </p>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => handleEdit(template)}
                    className="rounded p-1 text-gray-400 hover:text-white"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => {
                      if (confirm("Eliminar este template?")) {
                        deleteTemplate.mutate({ id: template.id });
                      }
                    }}
                    className="rounded p-1 text-gray-400 hover:text-red-400"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-500">
          No tienes templates aun. Crea uno para agilizar tus respuestas.
        </p>
      )}
    </div>
  );
}
