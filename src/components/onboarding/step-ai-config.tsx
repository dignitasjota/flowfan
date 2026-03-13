"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const providers = [
  { value: "anthropic", label: "Anthropic (Claude)", defaultModel: "claude-sonnet-4-6-20250514" },
  { value: "openai", label: "OpenAI (GPT-4)", defaultModel: "gpt-4o" },
  { value: "google", label: "Google (Gemini)", defaultModel: "gemini-2.5-pro" },
] as const;

type Props = {
  onComplete: () => void;
};

export function StepAIConfig({ onComplete }: Props) {
  const [provider, setProvider] = useState("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const upsertMutation = trpc.aiConfig.upsert.useMutation();
  const testMutation = trpc.aiConfig.testConnection.useMutation();

  const selectedProvider = providers.find((p) => p.value === provider)!;

  async function handleTest() {
    setTestResult(null);
    const result = await testMutation.mutateAsync({
      provider: provider as any,
      model: selectedProvider.defaultModel,
      apiKey,
    });
    setTestResult(result);
  }

  async function handleSave() {
    await upsertMutation.mutateAsync({
      provider: provider as any,
      model: selectedProvider.defaultModel,
      apiKey,
    });
    onComplete();
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-white">
          Configura tu proveedor de IA
        </h3>
        <p className="mt-1 text-sm text-gray-400">
          Necesitas una API key para que la IA genere sugerencias. Puedes
          cambiar de proveedor despues.
        </p>
      </div>

      <div className="space-y-2">
        {providers.map((p) => (
          <button
            key={p.value}
            onClick={() => {
              setProvider(p.value);
              setTestResult(null);
            }}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors",
              provider === p.value
                ? "border-indigo-500 bg-indigo-500/10 text-white"
                : "border-gray-700 text-gray-400 hover:border-gray-600"
            )}
          >
            <span className="font-medium">{p.label}</span>
          </button>
        ))}
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-gray-300">
          API Key
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
            setTestResult(null);
          }}
          placeholder={`Pega tu ${selectedProvider.label} API key...`}
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
        />
      </div>

      {testResult && (
        <div
          className={cn(
            "rounded-lg border px-4 py-3 text-sm",
            testResult.success
              ? "border-green-500/30 bg-green-500/10 text-green-400"
              : "border-red-500/30 bg-red-500/10 text-red-400"
          )}
        >
          {testResult.message}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={handleTest}
          disabled={!apiKey || testMutation.isPending}
          className="flex-1 rounded-lg border border-gray-700 py-2.5 text-sm font-medium text-gray-300 hover:bg-gray-800 disabled:opacity-50"
        >
          {testMutation.isPending ? "Probando..." : "Probar conexion"}
        </button>
        <button
          onClick={handleSave}
          disabled={!apiKey || upsertMutation.isPending}
          className="flex-1 rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {upsertMutation.isPending ? "Guardando..." : "Siguiente"}
        </button>
      </div>
    </div>
  );
}
