"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

const PLATFORM_LABELS: Record<string, string> = {
  reddit: "Reddit",
  twitter: "Twitter / X",
  instagram: "Instagram",
};

const PLATFORM_ICONS: Record<string, string> = {
  reddit: "👽",
  twitter: "🐦",
  instagram: "📷",
};

export function AccountsPanel() {
  const utils = trpc.useUtils();
  const accounts = trpc.scheduler.listAccounts.useQuery();
  const [showRedditForm, setShowRedditForm] = useState(false);

  const enableWebhook = trpc.scheduler.enableWebhookConnection.useMutation({
    onSuccess: () => utils.scheduler.listAccounts.invalidate(),
  });
  const disconnect = trpc.scheduler.disconnectAccount.useMutation({
    onSuccess: () => utils.scheduler.listAccounts.invalidate(),
  });

  const accountByPlatform = new Map(
    (accounts.data ?? []).map((a) => [a.platformType, a])
  );

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">Cuentas conectadas</h2>
      <p className="text-sm text-gray-400">
        Conecta una cuenta por plataforma. Reddit soporta publicación nativa
        directa. El resto se publica vía webhook (Zapier / Make / API propia).
      </p>

      {(["reddit", "twitter", "instagram"] as const).map((p) => {
        const account = accountByPlatform.get(p);
        return (
          <div
            key={p}
            className="rounded-lg border border-gray-800 bg-gray-900/40 p-4"
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  {PLATFORM_ICONS[p]} {PLATFORM_LABELS[p]}
                </h3>
                {account ? (
                  <div className="mt-1 space-y-0.5 text-xs">
                    <div className="text-emerald-400">
                      Conectada{" "}
                      {account.connectionType === "native"
                        ? "(API nativa)"
                        : "(webhook)"}
                    </div>
                    {account.accountUsername && (
                      <div className="text-gray-400">
                        Usuario: {account.accountUsername}
                      </div>
                    )}
                    {account.lastErrorMessage && (
                      <div className="text-red-400">
                        Último error: {account.lastErrorMessage}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-1 text-xs text-gray-500">No conectada</div>
                )}
              </div>

              <div className="flex flex-col gap-1">
                {account ? (
                  <button
                    onClick={() => {
                      if (confirm(`¿Desconectar ${PLATFORM_LABELS[p]}?`)) {
                        disconnect.mutate({ id: account.id });
                      }
                    }}
                    className="rounded-md bg-red-500/20 px-3 py-1 text-xs text-red-300 hover:bg-red-500/30"
                  >
                    Desconectar
                  </button>
                ) : (
                  <>
                    {p === "reddit" && (
                      <button
                        onClick={() => setShowRedditForm((v) => !v)}
                        className="rounded-md bg-indigo-600 px-3 py-1 text-xs text-white hover:bg-indigo-500"
                      >
                        Conectar API
                      </button>
                    )}
                    <button
                      onClick={() => enableWebhook.mutate({ platformType: p })}
                      className="rounded-md bg-gray-700 px-3 py-1 text-xs text-gray-200 hover:bg-gray-600"
                    >
                      Vía webhook
                    </button>
                  </>
                )}
              </div>
            </div>

            {p === "reddit" && showRedditForm && !account && (
              <ConnectRedditForm
                onConnected={() => {
                  setShowRedditForm(false);
                  utils.scheduler.listAccounts.invalidate();
                }}
                onCancel={() => setShowRedditForm(false)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ConnectRedditForm({
  onConnected,
  onCancel,
}: {
  onConnected: () => void;
  onCancel: () => void;
}) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const connect = trpc.scheduler.connectReddit.useMutation({
    onSuccess: () => onConnected(),
    onError: (err) => setError(err.message),
  });

  return (
    <div className="mt-4 space-y-2 rounded-md border border-gray-700 bg-gray-950/50 p-3">
      <div className="text-xs text-gray-400">
        Crea una "personal use script" en{" "}
        <a
          href="https://www.reddit.com/prefs/apps"
          target="_blank"
          rel="noreferrer"
          className="text-indigo-400 hover:underline"
        >
          reddit.com/prefs/apps
        </a>{" "}
        y copia los datos aquí. Las credenciales se cifran antes de
        almacenarse.
      </div>
      <input
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        placeholder="Client ID"
        className="w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white placeholder-gray-500"
      />
      <input
        value={clientSecret}
        onChange={(e) => setClientSecret(e.target.value)}
        placeholder="Client Secret"
        type="password"
        className="w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white placeholder-gray-500"
      />
      <input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Reddit username"
        className="w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white placeholder-gray-500"
      />
      <input
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Reddit password"
        type="password"
        className="w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white placeholder-gray-500"
      />
      {error && (
        <div
          className={cn(
            "rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-300"
          )}
        >
          {error}
        </div>
      )}
      <div className="flex gap-2">
        <button
          onClick={() =>
            connect.mutate({ clientId, clientSecret, username, password })
          }
          disabled={connect.isPending}
          className="flex-1 rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {connect.isPending ? "Verificando..." : "Conectar"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-md bg-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-600"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
