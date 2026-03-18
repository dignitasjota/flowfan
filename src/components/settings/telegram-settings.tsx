"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";

export function TelegramSettings() {
  const utils = trpc.useUtils();
  const status = trpc.telegram.getStatus.useQuery();
  const connectMutation = trpc.telegram.connect.useMutation({
    onSuccess: () => {
      utils.telegram.getStatus.invalidate();
      setBotToken("");
    },
  });
  const disconnectMutation = trpc.telegram.disconnect.useMutation({
    onSuccess: () => utils.telegram.getStatus.invalidate(),
  });
  const updateSettingsMutation = trpc.telegram.updateSettings.useMutation({
    onSuccess: () => utils.telegram.getStatus.invalidate(),
  });
  const testMutation = trpc.telegram.testConnection.useMutation();

  const [botToken, setBotToken] = useState("");
  const [showToken, setShowToken] = useState(false);

  // Settings form state
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [autoReplyDelay, setAutoReplyDelay] = useState(0);
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [settingsInitialized, setSettingsInitialized] = useState(false);

  // Sync settings from server once
  if (status.data && "connected" in status.data && status.data.connected && !settingsInitialized) {
    setAutoReplyEnabled(status.data.autoReplyEnabled);
    setAutoReplyDelay(status.data.autoReplyDelaySec);
    setWelcomeMessage(status.data.welcomeMessage ?? "");
    setErrorMessage(status.data.errorMessage ?? "");
    setSettingsInitialized(true);
  }

  const isConnected = status.data && "connected" in status.data && status.data.connected;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-white">Integración Telegram</h3>
        <p className="mt-1 text-sm text-gray-400">
          Conecta un bot de Telegram para recibir y responder mensajes de fans directamente.
        </p>
      </div>

      {/* Connection status */}
      <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-lg">
              ✈️
            </div>
            <div>
              <p className="text-sm font-medium text-white">
                {isConnected ? `@${status.data.botUsername}` : "No conectado"}
              </p>
              <p className="text-xs text-gray-400">
                {isConnected
                  ? status.data.status === "connected"
                    ? "Conectado y activo"
                    : status.data.status === "error"
                      ? "Error de conexión"
                      : "Desconectado"
                  : "Conecta un bot para empezar"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isConnected && (
              <>
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    status.data.status === "connected"
                      ? "bg-green-500"
                      : status.data.status === "error"
                        ? "bg-red-500"
                        : "bg-gray-500"
                  }`}
                />
                <button
                  onClick={() => testMutation.mutate()}
                  disabled={testMutation.isPending}
                  className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-50"
                >
                  {testMutation.isPending ? "Verificando..." : "Test"}
                </button>
                <button
                  onClick={() => {
                    if (confirm("¿Desconectar el bot de Telegram?")) {
                      disconnectMutation.mutate();
                    }
                  }}
                  disabled={disconnectMutation.isPending}
                  className="rounded-lg border border-red-800 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/30 disabled:opacity-50"
                >
                  Desconectar
                </button>
              </>
            )}
          </div>
        </div>

        {/* Test result */}
        {testMutation.data && (
          <div
            className={`mt-3 rounded-md p-3 text-xs ${
              testMutation.data.healthy
                ? "bg-green-900/20 text-green-400"
                : "bg-red-900/20 text-red-400"
            }`}
          >
            {testMutation.data.healthy ? (
              <p>Conexión verificada. Webhook activo, {testMutation.data.pendingUpdates} updates pendientes.</p>
            ) : (
              <p>Error: {testMutation.data.lastError ?? "Webhook no coincide"}</p>
            )}
          </div>
        )}
      </div>

      {/* Connect form */}
      {!isConnected && (
        <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
          <h4 className="text-sm font-medium text-white">Conectar Bot</h4>
          <p className="mt-1 text-xs text-gray-400">
            Crea un bot con @BotFather en Telegram y pega el token aquí.
          </p>

          <div className="mt-3 space-y-3">
            <div className="relative">
              <input
                type={showToken ? "text" : "password"}
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 pr-20 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-white"
              >
                {showToken ? "Ocultar" : "Mostrar"}
              </button>
            </div>

            {connectMutation.error && (
              <p className="text-xs text-red-400">{connectMutation.error.message}</p>
            )}

            <button
              onClick={() => connectMutation.mutate({ botToken })}
              disabled={!botToken || connectMutation.isPending}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {connectMutation.isPending ? "Conectando..." : "Conectar Bot"}
            </button>
          </div>

          <div className="mt-4 rounded-md bg-gray-800/50 p-3">
            <p className="text-xs font-medium text-gray-300">Instrucciones:</p>
            <ol className="mt-1 list-inside list-decimal space-y-1 text-xs text-gray-400">
              <li>Abre Telegram y busca @BotFather</li>
              <li>Envía /newbot y sigue las instrucciones</li>
              <li>Copia el token que te da BotFather</li>
              <li>Pégalo aquí y haz click en Conectar</li>
            </ol>
          </div>
        </div>
      )}

      {/* Settings (only when connected) */}
      {isConnected && (
        <div className="space-y-4 rounded-lg border border-gray-800 bg-gray-900/50 p-4">
          <h4 className="text-sm font-medium text-white">Configuración del Bot</h4>

          {/* Auto-reply toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white">Respuesta automática con IA</p>
              <p className="text-xs text-gray-400">
                La IA responderá automáticamente a los mensajes entrantes.
              </p>
            </div>
            <button
              onClick={() => {
                const newValue = !autoReplyEnabled;
                setAutoReplyEnabled(newValue);
                updateSettingsMutation.mutate({ autoReplyEnabled: newValue });
              }}
              className={`relative h-6 w-11 rounded-full transition-colors ${
                autoReplyEnabled ? "bg-indigo-600" : "bg-gray-700"
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  autoReplyEnabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* Auto-reply delay */}
          {autoReplyEnabled && (
            <div>
              <label className="text-sm text-gray-300">Delay antes de responder (segundos)</label>
              <input
                type="number"
                min={0}
                max={300}
                value={autoReplyDelay}
                onChange={(e) => setAutoReplyDelay(Number(e.target.value))}
                onBlur={() =>
                  updateSettingsMutation.mutate({ autoReplyDelaySec: autoReplyDelay })
                }
                className="mt-1 w-24 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
              />
              <p className="mt-1 text-xs text-gray-500">
                0 = respuesta inmediata. Un delay hace que parezca más natural.
              </p>
            </div>
          )}

          {/* Welcome message */}
          <div>
            <label className="text-sm text-gray-300">Mensaje de bienvenida</label>
            <textarea
              value={welcomeMessage}
              onChange={(e) => setWelcomeMessage(e.target.value)}
              onBlur={() =>
                updateSettingsMutation.mutate({
                  welcomeMessage: welcomeMessage || null,
                })
              }
              placeholder="Se envía automáticamente cuando un nuevo contacto escribe por primera vez."
              rows={3}
              className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {/* Error message */}
          <div>
            <label className="text-sm text-gray-300">Mensaje de error</label>
            <textarea
              value={errorMessage}
              onChange={(e) => setErrorMessage(e.target.value)}
              onBlur={() =>
                updateSettingsMutation.mutate({
                  errorMessage: errorMessage || null,
                })
              }
              placeholder="Se envía si hay un error procesando el mensaje."
              rows={2}
              className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {updateSettingsMutation.error && (
            <p className="text-xs text-red-400">{updateSettingsMutation.error.message}</p>
          )}
        </div>
      )}
    </div>
  );
}
