"use client";

import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const CONTACT_FIELD_OPTIONS = [
  { value: "", label: "(Omitir)" },
  { value: "username", label: "Username *" },
  { value: "platformType", label: "Plataforma *" },
  { value: "displayName", label: "Nombre" },
  { value: "tags", label: "Tags (separados por ;)" },
  { value: "platformUserId", label: "Platform User ID" },
];

type Step = 1 | 2 | 3 | 4;

export default function ImportPage() {
  const [step, setStep] = useState<Step>(1);
  const [jobId, setJobId] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = trpc.import.upload.useMutation();
  const setMappingMutation = trpc.import.setMapping.useMutation();
  const confirm = trpc.import.confirm.useMutation();
  const preview = trpc.import.preview.useQuery(
    { jobId: jobId! },
    { enabled: step === 3 && !!jobId }
  );
  const status = trpc.import.getStatus.useQuery(
    { jobId: jobId! },
    {
      enabled: step === 4 && !!jobId,
      refetchInterval: (query) => {
        const s = query.state.data?.status;
        return s === "processing" ? 2000 : false;
      },
    }
  );

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    const text = await file.text();
    try {
      const result = await upload.mutateAsync({
        csvContent: text,
        fileName: file.name,
      });
      setJobId(result.jobId);
      setHeaders(result.headers);
      setPreviewRows(result.previewRows);
      setTotalRows(result.totalRows);
      setMapping(
        Object.fromEntries(
          Object.entries(result.autoMapping).map(([k, v]) => [k, v ?? ""])
        )
      );
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error subiendo archivo");
    }
  }

  async function handleSetMapping() {
    if (!jobId) return;
    setError(null);

    const cleanMapping: Record<string, string | null> = {};
    for (const [header, field] of Object.entries(mapping)) {
      cleanMapping[header] = field || null;
    }

    try {
      await setMappingMutation.mutateAsync({ jobId, mapping: cleanMapping });
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error configurando mapeo");
    }
  }

  async function handleConfirm() {
    if (!jobId) return;
    setError(null);
    try {
      await confirm.mutateAsync({ jobId, skipDuplicates });
      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error iniciando importacion");
    }
  }

  const hasUsername = Object.values(mapping).includes("username");
  const hasPlatform = Object.values(mapping).includes("platformType");

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white sm:text-2xl">Importar Contactos</h1>
        <p className="mt-1 text-sm text-gray-400">Sube un archivo CSV para importar contactos masivamente</p>
      </div>

      {/* Steps indicator */}
      <div className="mb-8 flex items-center gap-2">
        {[1, 2, 3, 4].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium",
                step >= s ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-500"
              )}
            >
              {s}
            </div>
            <span className={cn("text-xs", step >= s ? "text-white" : "text-gray-500")}>
              {s === 1 ? "Subir" : s === 2 ? "Mapear" : s === 3 ? "Preview" : "Importar"}
            </span>
            {s < 4 && <div className="mx-2 h-px w-8 bg-gray-700" />}
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Step 1: Upload */}
      {step === 1 && (
        <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-6">
          <h3 className="mb-4 text-sm font-medium text-white">Selecciona un archivo CSV</h3>
          <p className="mb-4 text-xs text-gray-400">
            El archivo debe tener una fila de headers y como minimo las columnas de username y plataforma.
            Plataformas validas: instagram, tinder, reddit, onlyfans, twitter, telegram, snapchat, other.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            onChange={handleFileUpload}
            className="block w-full text-sm text-gray-400 file:mr-4 file:rounded file:border-0 file:bg-indigo-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-indigo-500"
          />
          {upload.isPending && (
            <p className="mt-4 text-sm text-gray-400">Procesando archivo...</p>
          )}
        </div>
      )}

      {/* Step 2: Column Mapping */}
      {step === 2 && (
        <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-6">
          <h3 className="mb-4 text-sm font-medium text-white">
            Mapear columnas ({totalRows} filas detectadas)
          </h3>
          <div className="space-y-3">
            {headers.map((header) => (
              <div key={header} className="flex items-center gap-4">
                <span className="w-40 truncate text-sm text-gray-300">{header}</span>
                <span className="text-gray-600">→</span>
                <select
                  value={mapping[header] ?? ""}
                  onChange={(e) =>
                    setMapping((prev) => ({ ...prev, [header]: e.target.value }))
                  }
                  className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white"
                >
                  {CONTACT_FIELD_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {/* Preview of first rows */}
          {previewRows.length > 0 && (
            <div className="mt-6">
              <h4 className="mb-2 text-xs font-medium text-gray-400">Preview (primeras filas)</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      {headers.map((h) => (
                        <th key={h} className="px-2 py-1 text-left text-gray-500">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i} className="border-t border-gray-800">
                        {row.map((cell, j) => (
                          <td key={j} className="px-2 py-1 text-gray-300">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={() => setStep(1)}
              className="rounded bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
            >
              Atras
            </button>
            <button
              onClick={handleSetMapping}
              disabled={!hasUsername || !hasPlatform || setMappingMutation.isPending}
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {setMappingMutation.isPending ? "Guardando..." : "Continuar"}
            </button>
            {(!hasUsername || !hasPlatform) && (
              <span className="text-xs text-red-400">
                Mapea al menos Username y Plataforma
              </span>
            )}
          </div>
        </div>
      )}

      {/* Step 3: Preview & Confirm */}
      {step === 3 && (
        <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-6">
          <h3 className="mb-4 text-sm font-medium text-white">Preview de importacion</h3>

          {preview.isLoading ? (
            <p className="text-sm text-gray-400">Analizando datos...</p>
          ) : preview.data ? (
            <>
              {/* Summary */}
              <div className="mb-4 grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-gray-800 p-3">
                  <p className="text-xs text-gray-400">Nuevos</p>
                  <p className="text-lg font-bold text-green-400">{preview.data.newCount}</p>
                </div>
                <div className="rounded-lg bg-gray-800 p-3">
                  <p className="text-xs text-gray-400">Duplicados</p>
                  <p className="text-lg font-bold text-orange-400">{preview.data.duplicateCount}</p>
                </div>
                <div className="rounded-lg bg-gray-800 p-3">
                  <p className="text-xs text-gray-400">Total</p>
                  <p className="text-lg font-bold text-white">{preview.data.totalRows}</p>
                </div>
              </div>

              {/* Mapped rows preview */}
              <div className="mb-4 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th className="px-2 py-1 text-left text-gray-500">Username</th>
                      <th className="px-2 py-1 text-left text-gray-500">Plataforma</th>
                      <th className="px-2 py-1 text-left text-gray-500">Nombre</th>
                      <th className="px-2 py-1 text-left text-gray-500">Tags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.data.rows.map((row, i) => (
                      <tr key={i} className="border-t border-gray-800">
                        <td className="px-2 py-1 text-gray-300">{row.username ?? "-"}</td>
                        <td className="px-2 py-1 text-gray-300">{row.platformType ?? "-"}</td>
                        <td className="px-2 py-1 text-gray-300">{row.displayName ?? "-"}</td>
                        <td className="px-2 py-1 text-gray-300">{row.tags ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Options */}
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={skipDuplicates}
                  onChange={(e) => setSkipDuplicates(e.target.checked)}
                  className="rounded border-gray-600"
                />
                Omitir duplicados
              </label>

              <div className="mt-6 flex items-center gap-3">
                <button
                  onClick={() => setStep(2)}
                  className="rounded bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
                >
                  Atras
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={confirm.isPending}
                  className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {confirm.isPending ? "Iniciando..." : `Importar ${preview.data.newCount} contactos`}
                </button>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* Step 4: Progress */}
      {step === 4 && (
        <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-6">
          <h3 className="mb-4 text-sm font-medium text-white">Importando contactos...</h3>

          {status.data ? (
            <>
              {/* Progress bar */}
              <div className="mb-4">
                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span>
                    {status.data.processedRows} / {status.data.totalRows} filas procesadas
                  </span>
                  <span>
                    {status.data.totalRows > 0
                      ? Math.round((status.data.processedRows / status.data.totalRows) * 100)
                      : 0}
                    %
                  </span>
                </div>
                <div className="mt-2 h-3 rounded-full bg-gray-800">
                  <div
                    className={cn(
                      "h-3 rounded-full transition-all",
                      status.data.status === "completed"
                        ? "bg-green-500"
                        : status.data.status === "failed"
                          ? "bg-red-500"
                          : "bg-indigo-500"
                    )}
                    style={{
                      width: `${status.data.totalRows > 0 ? (status.data.processedRows / status.data.totalRows) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>

              {/* Stats */}
              <div className="mb-4 grid grid-cols-4 gap-3">
                <div className="rounded-lg bg-gray-800 p-3">
                  <p className="text-xs text-gray-400">Creados</p>
                  <p className="text-lg font-bold text-green-400">{status.data.createdCount}</p>
                </div>
                <div className="rounded-lg bg-gray-800 p-3">
                  <p className="text-xs text-gray-400">Omitidos</p>
                  <p className="text-lg font-bold text-yellow-400">{status.data.skippedCount}</p>
                </div>
                <div className="rounded-lg bg-gray-800 p-3">
                  <p className="text-xs text-gray-400">Duplicados</p>
                  <p className="text-lg font-bold text-orange-400">{status.data.duplicateCount}</p>
                </div>
                <div className="rounded-lg bg-gray-800 p-3">
                  <p className="text-xs text-gray-400">Errores</p>
                  <p className="text-lg font-bold text-red-400">{status.data.errorCount}</p>
                </div>
              </div>

              {/* Status message */}
              {status.data.status === "completed" && (
                <div className="rounded-lg border border-green-800 bg-green-900/30 px-4 py-3 text-sm text-green-300">
                  Importacion completada. {status.data.createdCount} contactos creados.
                </div>
              )}
              {status.data.status === "failed" && (
                <div className="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">
                  La importacion fallo. Revisa los errores.
                </div>
              )}

              {/* Actions */}
              {(status.data.status === "completed" || status.data.status === "failed") && (
                <div className="mt-4 flex gap-3">
                  <a
                    href="/contacts"
                    className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
                  >
                    Ver contactos
                  </a>
                  <button
                    onClick={() => {
                      setStep(1);
                      setJobId(null);
                      setError(null);
                    }}
                    className="rounded bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
                  >
                    Nueva importacion
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-400">Iniciando importacion...</p>
          )}
        </div>
      )}
    </div>
  );
}
