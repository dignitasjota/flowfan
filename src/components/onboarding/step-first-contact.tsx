"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useTrpcErrorHandler } from "@/hooks/useTrpcErrorHandler";
import { PLATFORM_OPTIONS, type PlatformType } from "@/lib/constants";

type Props = {
  onComplete: () => void;
};

export function StepFirstContact({ onComplete }: Props) {
  const [username, setUsername] = useState("");
  const [platform, setPlatform] = useState<PlatformType>("instagram");
  const [error, setError] = useState<string | null>(null);
  const createMutation = trpc.contacts.create.useMutation();
  const { handleError } = useTrpcErrorHandler();

  async function handleCreate() {
    setError(null);

    if (!username.trim()) {
      onComplete();
      return;
    }

    try {
      await createMutation.mutateAsync({
        username: username.trim(),
        platformType: platform,
      });
      onComplete();
    } catch (err) {
      if (!handleError(err)) {
        setError("Error al crear el contacto. Intenta de nuevo.");
        console.error("Error creating contact:", err);
      }
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-white">
          Añade tu primer contacto
        </h3>
        <p className="mt-1 text-sm text-gray-400">
          Añade un fan para empezar a usar FanFlow. Puedes saltar este paso si
          prefieres.
        </p>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-gray-300">
          Username del fan
        </label>
        <input
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setError(null);
          }}
          placeholder="@username"
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
        />
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div>
        <label className="mb-2 block text-sm font-medium text-gray-300">
          Plataforma
        </label>
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value as PlatformType)}
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
        >
          {PLATFORM_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onComplete}
          className="flex-1 rounded-lg border border-gray-700 py-2.5 text-sm font-medium text-gray-300 hover:bg-gray-800"
        >
          Saltar
        </button>
        <button
          onClick={handleCreate}
          disabled={createMutation.isPending}
          className="flex-1 rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {createMutation.isPending ? "Creando..." : "Crear y finalizar"}
        </button>
      </div>
    </div>
  );
}
