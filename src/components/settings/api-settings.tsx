"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";

const WEBHOOK_EVENTS = [
  { value: "contact.created", label: "Contacto creado" },
  { value: "contact.updated", label: "Contacto actualizado" },
  { value: "message.received", label: "Mensaje recibido" },
  { value: "funnel_stage.changed", label: "Cambio de funnel" },
  { value: "transaction.created", label: "Transaccion creada" },
] as const;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="rounded bg-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-600"
    >
      {copied ? "Copiado!" : "Copiar"}
    </button>
  );
}

function ApiKeysSection() {
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const keysQuery = trpc.apiKeys.list.useQuery(undefined, {
    retry: false,
  });
  const createMutation = trpc.apiKeys.create.useMutation({
    onSuccess: (data) => {
      setCreatedKey(data.rawKey);
      setNewKeyName("");
      keysQuery.refetch();
    },
  });
  const revokeMutation = trpc.apiKeys.revoke.useMutation({
    onSuccess: () => keysQuery.refetch(),
  });

  return (
    <section className="space-y-4">
      <h4 className="text-sm font-semibold text-white">API Keys</h4>
      <p className="text-xs text-gray-400">
        Las API keys permiten acceso programatico a tus datos via REST API en /api/v1/.
      </p>

      {/* Create new key */}
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Nombre de la key (ej: Zapier, Google Sheets)"
          value={newKeyName}
          onChange={(e) => setNewKeyName(e.target.value)}
          className="flex-1 rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
        />
        <button
          onClick={() => createMutation.mutate({ name: newKeyName })}
          disabled={!newKeyName.trim() || createMutation.isPending}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Generar
        </button>
      </div>

      {/* Show newly created key */}
      {createdKey && (
        <div className="rounded-lg border border-green-800 bg-green-900/20 p-4">
          <p className="mb-2 text-sm font-medium text-green-400">
            API Key creada. Copiala ahora, no se mostrara de nuevo.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-gray-800 px-3 py-2 text-sm text-white">
              {createdKey}
            </code>
            <CopyButton text={createdKey} />
          </div>
          <button
            onClick={() => setCreatedKey(null)}
            className="mt-2 text-xs text-gray-400 hover:text-white"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Keys list */}
      {keysQuery.error ? (
        <p className="text-sm text-yellow-400">{keysQuery.error.message}</p>
      ) : keysQuery.data && keysQuery.data.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-gray-800">
          <table className="w-full text-sm">
            <thead className="bg-gray-800/50">
              <tr>
                <th className="px-4 py-2 text-left text-gray-400">Nombre</th>
                <th className="px-4 py-2 text-left text-gray-400">Prefix</th>
                <th className="px-4 py-2 text-left text-gray-400">Creada</th>
                <th className="px-4 py-2 text-left text-gray-400">Ultimo uso</th>
                <th className="px-4 py-2 text-left text-gray-400">Estado</th>
                <th className="px-4 py-2 text-left text-gray-400"></th>
              </tr>
            </thead>
            <tbody>
              {keysQuery.data.map((key) => (
                <tr key={key.id} className="border-t border-gray-800">
                  <td className="px-4 py-2 text-white">{key.name}</td>
                  <td className="px-4 py-2 font-mono text-gray-400">{key.keyPrefix}...</td>
                  <td className="px-4 py-2 text-gray-400">
                    {new Date(key.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2 text-gray-400">
                    {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : "Nunca"}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs ${key.isActive ? "bg-green-900/50 text-green-400" : "bg-red-900/50 text-red-400"}`}>
                      {key.isActive ? "Activa" : "Revocada"}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {key.isActive && (
                      <button
                        onClick={() => revokeMutation.mutate({ id: key.id })}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        Revocar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-gray-500">No hay API keys creadas.</p>
      )}
    </section>
  );
}

function WebhooksSection() {
  const [showCreate, setShowCreate] = useState(false);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [expandedLogs, setExpandedLogs] = useState<string | null>(null);

  const webhooksQuery = trpc.webhooksOutgoing.list.useQuery(undefined, {
    retry: false,
  });
  const createMutation = trpc.webhooksOutgoing.create.useMutation({
    onSuccess: () => {
      setShowCreate(false);
      setUrl("");
      setEvents([]);
      setDescription("");
      webhooksQuery.refetch();
    },
  });
  const updateMutation = trpc.webhooksOutgoing.update.useMutation({
    onSuccess: () => webhooksQuery.refetch(),
  });
  const deleteMutation = trpc.webhooksOutgoing.delete.useMutation({
    onSuccess: () => webhooksQuery.refetch(),
  });
  const testMutation = trpc.webhooksOutgoing.testWebhook.useMutation();
  const logsQuery = trpc.webhooksOutgoing.getDeliveryLogs.useQuery(
    { webhookConfigId: expandedLogs ?? "", limit: 10 },
    { enabled: !!expandedLogs }
  );

  function toggleEvent(event: string) {
    setEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-white">Webhooks</h4>
          <p className="text-xs text-gray-400">
            Recibe notificaciones HTTP cuando ocurren eventos en FanFlow.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          {showCreate ? "Cancelar" : "Crear webhook"}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="space-y-3 rounded-lg border border-gray-800 p-4">
          <input
            type="url"
            placeholder="https://ejemplo.com/webhook"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
          />
          <input
            type="text"
            placeholder="Descripcion (opcional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
          />
          <div>
            <p className="mb-2 text-xs text-gray-400">Eventos:</p>
            <div className="flex flex-wrap gap-2">
              {WEBHOOK_EVENTS.map((e) => (
                <button
                  key={e.value}
                  onClick={() => toggleEvent(e.value)}
                  className={`rounded px-3 py-1.5 text-xs transition-colors ${
                    events.includes(e.value)
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-800 text-gray-400 hover:text-white"
                  }`}
                >
                  {e.label}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={() => createMutation.mutate({ url, events: events as any, description: description || undefined })}
            disabled={!url || events.length === 0 || createMutation.isPending}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Crear
          </button>
        </div>
      )}

      {/* Webhooks list */}
      {webhooksQuery.error ? (
        <p className="text-sm text-yellow-400">{webhooksQuery.error.message}</p>
      ) : webhooksQuery.data && webhooksQuery.data.length > 0 ? (
        <div className="space-y-3">
          {webhooksQuery.data.map((wh) => (
            <div key={wh.id} className="rounded-lg border border-gray-800 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-white">{wh.url}</p>
                  {wh.description && <p className="text-xs text-gray-400">{wh.description}</p>}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(wh.events as string[]).map((ev) => (
                      <span key={ev} className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
                        {ev}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateMutation.mutate({ id: wh.id, isActive: !wh.isActive })}
                    className={`rounded px-2 py-1 text-xs ${wh.isActive ? "bg-green-900/50 text-green-400" : "bg-gray-800 text-gray-500"}`}
                  >
                    {wh.isActive ? "Activo" : "Inactivo"}
                  </button>
                  <button
                    onClick={() => testMutation.mutate({ id: wh.id })}
                    className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-400 hover:text-white"
                  >
                    Test
                  </button>
                  <button
                    onClick={() => setExpandedLogs(expandedLogs === wh.id ? null : wh.id)}
                    className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-400 hover:text-white"
                  >
                    Logs
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate({ id: wh.id })}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    Eliminar
                  </button>
                </div>
              </div>

              {/* Delivery logs */}
              {expandedLogs === wh.id && logsQuery.data && (
                <div className="mt-3 space-y-1 border-t border-gray-800 pt-3">
                  <p className="text-xs font-medium text-gray-400">Ultimos envios:</p>
                  {logsQuery.data.length === 0 ? (
                    <p className="text-xs text-gray-500">Sin envios registrados.</p>
                  ) : (
                    logsQuery.data.map((log) => (
                      <div key={log.id} className="flex items-center gap-3 text-xs">
                        <span className={`w-8 text-center ${log.statusCode && log.statusCode < 400 ? "text-green-400" : "text-red-400"}`}>
                          {log.statusCode ?? "ERR"}
                        </span>
                        <span className="text-gray-400">{log.event}</span>
                        <span className="text-gray-500">
                          {new Date(log.createdAt).toLocaleString()}
                        </span>
                        {log.error && <span className="text-red-400">{log.error}</span>}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-500">No hay webhooks configurados.</p>
      )}
    </section>
  );
}

export function ApiSettings() {
  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-medium text-white">API y Webhooks</h3>
        <p className="mt-1 text-sm text-gray-400">
          Gestiona el acceso programatico a FanFlow y las notificaciones a sistemas externos.
        </p>
      </div>

      <ApiKeysSection />
      <div className="border-t border-gray-800" />
      <WebhooksSection />
    </div>
  );
}
