"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";

type Variant = { key: string; label: string; content: string };

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-700 text-gray-200",
  running: "bg-emerald-500/15 text-emerald-400",
  completed: "bg-indigo-500/15 text-indigo-400",
};

export default function ExperimentsPage() {
  const utils = trpc.useUtils();
  const listQuery = trpc.messageExperiments.list.useQuery();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">A/B de Mensajes</h1>
            <p className="mt-1 text-sm text-gray-400">
              Prueba variantes de contenido y mide cuál genera más respuestas y
              conversiones.
            </p>
          </div>
          <button
            onClick={() => setShowCreate((s) => !s)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            {showCreate ? "Cerrar" : "+ Nuevo experimento"}
          </button>
        </div>

        {showCreate && (
          <CreateForm
            onCreated={() => {
              setShowCreate(false);
              utils.messageExperiments.list.invalidate();
            }}
          />
        )}

        <div className="mt-8 space-y-3">
          {listQuery.isLoading ? (
            <p className="text-sm text-gray-500">Cargando…</p>
          ) : listQuery.data && listQuery.data.length > 0 ? (
            listQuery.data.map((exp) => (
              <div
                key={exp.id}
                className="rounded-xl border border-gray-800 bg-gray-900"
              >
                <button
                  onClick={() =>
                    setSelectedId((cur) => (cur === exp.id ? null : exp.id))
                  }
                  className="flex w-full items-center justify-between px-5 py-4 text-left"
                >
                  <div>
                    <span className="font-medium text-white">{exp.name}</span>
                    <span className="ml-3 text-xs text-gray-500">
                      {((exp.variants as Variant[]) ?? []).length} variantes
                      {exp.platformType ? ` · ${exp.platformType}` : ""}
                    </span>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      STATUS_STYLES[exp.status] ?? "bg-gray-700 text-gray-200"
                    }`}
                  >
                    {exp.status}
                  </span>
                </button>
                {selectedId === exp.id && <ExperimentDetail id={exp.id} />}
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-gray-800 py-12 text-center text-sm text-gray-500">
              Aún no tienes experimentos. Crea uno para empezar a testear
              variantes de mensaje.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [variants, setVariants] = useState<Variant[]>([
    { key: "A", label: "Variante A", content: "" },
    { key: "B", label: "Variante B", content: "" },
  ]);
  const [error, setError] = useState("");

  const create = trpc.messageExperiments.create.useMutation({
    onSuccess: () => {
      setName("");
      setVariants([
        { key: "A", label: "Variante A", content: "" },
        { key: "B", label: "Variante B", content: "" },
      ]);
      onCreated();
    },
    onError: (e) => setError(e.message),
  });

  function updateVariant(i: number, patch: Partial<Variant>) {
    setVariants((vs) => vs.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  }

  function addVariant() {
    if (variants.length >= 5) return;
    const key = String.fromCharCode(65 + variants.length); // C, D, E
    setVariants((vs) => [
      ...vs,
      { key, label: `Variante ${key}`, content: "" },
    ]);
  }

  return (
    <div className="mt-6 rounded-xl border border-gray-800 bg-gray-900 p-5">
      <label className="block text-sm font-medium text-gray-300">Nombre</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Ej: Saludo de bienvenida"
        className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white"
      />

      <div className="mt-4 space-y-3">
        {variants.map((v, i) => (
          <div key={i} className="rounded-lg border border-gray-800 p-3">
            <div className="flex items-center gap-2">
              <span className="rounded bg-gray-800 px-2 py-0.5 text-xs font-semibold text-gray-300">
                {v.key}
              </span>
              <input
                value={v.label}
                onChange={(e) => updateVariant(i, { label: e.target.value })}
                className="flex-1 rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-white"
              />
            </div>
            <textarea
              value={v.content}
              onChange={(e) => updateVariant(i, { content: e.target.value })}
              placeholder="Contenido del mensaje… admite {{displayName}} y {{username}}"
              rows={3}
              className="mt-2 w-full rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm text-white"
            />
          </div>
        ))}
      </div>

      {variants.length < 5 && (
        <button
          onClick={addVariant}
          className="mt-3 text-xs text-indigo-400 hover:text-indigo-300"
        >
          + Añadir variante
        </button>
      )}

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <div className="mt-4 flex justify-end">
        <button
          disabled={
            create.isPending ||
            !name.trim() ||
            variants.some((v) => !v.content.trim())
          }
          onClick={() =>
            create.mutate({ name: name.trim(), variants })
          }
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {create.isPending ? "Creando…" : "Crear experimento"}
        </button>
      </div>
    </div>
  );
}

function ExperimentDetail({ id }: { id: string }) {
  const utils = trpc.useUtils();
  const detail = trpc.messageExperiments.get.useQuery({ id });

  const invalidate = () => {
    utils.messageExperiments.get.invalidate({ id });
    utils.messageExperiments.list.invalidate();
  };

  const start = trpc.messageExperiments.start.useMutation({ onSuccess: invalidate });
  const stop = trpc.messageExperiments.stop.useMutation({ onSuccess: invalidate });
  const applyWinner = trpc.messageExperiments.applyWinner.useMutation({
    onSuccess: invalidate,
  });
  const del = trpc.messageExperiments.delete.useMutation({
    onSuccess: () => utils.messageExperiments.list.invalidate(),
  });

  if (detail.isLoading || !detail.data) {
    return <div className="px-5 pb-5 text-sm text-gray-500">Cargando…</div>;
  }

  const { experiment, results } = detail.data;
  const variants = (experiment.variants as Variant[]) ?? [];

  return (
    <div className="border-t border-gray-800 px-5 py-4">
      <div className="mb-4 flex flex-wrap gap-2">
        {experiment.status === "draft" && (
          <button
            onClick={() => start.mutate({ id })}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
          >
            ▶ Iniciar
          </button>
        )}
        {experiment.status === "running" && (
          <button
            onClick={() => stop.mutate({ id })}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500"
          >
            ■ Detener
          </button>
        )}
        {experiment.status === "draft" && (
          <button
            onClick={() => {
              if (confirm("¿Eliminar este experimento?")) del.mutate({ id });
            }}
            className="rounded-lg border border-red-800 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-950"
          >
            Eliminar
          </button>
        )}
      </div>

      {/* Confianza */}
      <div className="mb-3 text-xs text-gray-400">
        Confianza estadística:{" "}
        <span
          className={
            results.confidence >= 0.95 ? "text-emerald-400" : "text-gray-300"
          }
        >
          {(results.confidence * 100).toFixed(0)}%
        </span>
        {results.suggestedWinnerKey && (
          <span className="ml-2 text-emerald-400">
            · Ganador sugerido: {results.suggestedWinnerKey}
          </span>
        )}
      </div>

      {/* Tabla de resultados */}
      <div className="overflow-hidden rounded-lg border border-gray-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-950 text-xs uppercase text-gray-500">
              <th className="px-3 py-2 text-left">Variante</th>
              <th className="px-3 py-2 text-right">Envíos</th>
              <th className="px-3 py-2 text-right">Respuestas</th>
              <th className="px-3 py-2 text-right">Tasa resp.</th>
              <th className="px-3 py-2 text-right">Conv.</th>
              <th className="px-3 py-2 text-right">Tasa conv.</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {results.variants.map((v) => {
              const variantDef = variants.find((vd) => vd.key === v.key);
              const isWinner = experiment.winnerVariantKey === v.key;
              const isLeader = results.leaderKey === v.key;
              return (
                <tr key={v.key} className={isLeader ? "bg-emerald-500/5" : ""}>
                  <td className="px-3 py-2">
                    <span className="font-medium text-white">{v.label}</span>
                    {isWinner && (
                      <span className="ml-2 text-xs text-emerald-400">✓ ganadora</span>
                    )}
                    <p className="mt-0.5 max-w-xs truncate text-xs text-gray-500">
                      {variantDef?.content}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-right text-gray-300">{v.sends}</td>
                  <td className="px-3 py-2 text-right text-gray-300">{v.replies}</td>
                  <td className="px-3 py-2 text-right text-gray-300">
                    {(v.replyRate * 100).toFixed(0)}%
                  </td>
                  <td className="px-3 py-2 text-right text-gray-300">
                    {v.conversions}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-300">
                    {(v.conversionRate * 100).toFixed(0)}%
                  </td>
                  <td className="px-3 py-2 text-right">
                    {experiment.status !== "draft" && !isWinner && (
                      <button
                        onClick={() =>
                          applyWinner.mutate({ id, variantKey: v.key })
                        }
                        className="text-xs text-indigo-400 hover:text-indigo-300"
                      >
                        Marcar ganadora
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
