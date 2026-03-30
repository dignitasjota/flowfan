"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { TableRowSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { PLATFORM_OPTIONS, FUNNEL_STAGES, type PlatformType, type FunnelStage } from "@/lib/constants";

const funnelOptions = FUNNEL_STAGES.map((s) => ({ value: s, label: s === "hot_lead" ? "Hot Lead" : s.charAt(0).toUpperCase() + s.slice(1) }));

export default function ContactsPage() {
  const [showNewForm, setShowNewForm] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPlatform, setNewPlatform] = useState<PlatformType>("instagram");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; username: string } | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [filterPlatform, setFilterPlatform] = useState<PlatformType | "">("");
  const [filterFunnel, setFilterFunnel] = useState<FunnelStage | "">("");
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const { success: toastSuccess } = useToast();

  const contactsQuery = trpc.contacts.list.useQuery({
    search: search || undefined,
    platformType: filterPlatform || undefined,
    funnelStage: filterFunnel || undefined,
    limit: pageSize,
    offset: page * pageSize,
  });

  const utils = trpc.useUtils();
  const deleteContact = trpc.contacts.delete.useMutation({
    onSuccess: (result) => {
      utils.contacts.list.invalidate();
      setDeleteTarget(null);
      if (result.action === "archived") {
        toastSuccess("Este contacto ha pagado anteriormente. Se ha archivado en lugar de eliminarlo.");
      } else {
        toastSuccess("Contacto eliminado correctamente");
      }
    },
  });
  const createContact = trpc.contacts.create.useMutation({
    onMutate: async () => {
      await utils.contacts.list.cancel();
    },
    onSuccess: () => {
      utils.contacts.list.invalidate();
      setShowNewForm(false);
      setNewUsername("");
      toastSuccess("Contacto creado correctamente");
    },
    onError: () => {
      utils.contacts.list.invalidate();
    },
  });

  const exportJson = trpc.intelligence.exportContactsData.useQuery(
    { format: "json" },
    { enabled: false }
  );
  const exportCsv = trpc.intelligence.exportContactsData.useQuery(
    { format: "csv" },
    { enabled: false }
  );

  function handleExport(format: "json" | "csv") {
    const query = format === "json" ? exportJson : exportCsv;
    query.refetch().then(({ data }) => {
      if (!data) return;
      const blob = new Blob([data.data], {
        type: format === "json" ? "application/json" : "text/csv",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `contactos-fanflow.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  const createConversation = trpc.conversations.create.useMutation({
    onSuccess: () => {
      window.location.href = "/conversations";
    },
  });

  async function handleCreateContact(e: React.FormEvent) {
    e.preventDefault();
    const contact = await createContact.mutateAsync({
      username: newUsername,
      platformType: newPlatform,
    });

    if (contact) {
      await createConversation.mutateAsync({
        contactId: contact.id,
        platformType: newPlatform,
      });
    }
  }

  const data = contactsQuery.data;
  const items = data?.items ?? data ?? [];
  const total = data?.total ?? (items as unknown[]).length;
  const hasMore = data?.hasMore ?? false;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
        <h2 className="text-lg font-semibold text-white">Contactos</h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => {
                const el = document.getElementById("export-menu");
                el?.classList.toggle("hidden");
              }}
              className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-400 hover:bg-gray-800 hover:text-white"
            >
              Exportar
            </button>
            <div
              id="export-menu"
              className="absolute right-0 top-full z-10 mt-1 hidden rounded-lg border border-gray-700 bg-gray-900 shadow-lg"
            >
              <button
                onClick={() => {
                  handleExport("csv");
                  document.getElementById("export-menu")?.classList.add("hidden");
                }}
                className="block w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-800"
              >
                CSV
              </button>
              <button
                onClick={() => {
                  handleExport("json");
                  document.getElementById("export-menu")?.classList.add("hidden");
                }}
                className="block w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-800"
              >
                JSON
              </button>
            </div>
          </div>
          <button
            onClick={() => setShowNewForm(!showNewForm)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            + Nuevo contacto
          </button>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-800 px-6 py-3">
        <div className="relative flex-1 min-w-[200px]">
          <svg
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Buscar por username o nombre..."
            className="w-full rounded-lg border border-gray-700 bg-gray-800 py-2 pl-10 pr-3 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
          />
        </div>
        <select
          value={filterPlatform}
          onChange={(e) => {
            setFilterPlatform(e.target.value as PlatformType | "");
            setPage(0);
          }}
          className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
        >
          <option value="">Todas las plataformas</option>
          {PLATFORM_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <select
          value={filterFunnel}
          onChange={(e) => {
            setFilterFunnel(e.target.value as FunnelStage | "");
            setPage(0);
          }}
          className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
        >
          <option value="">Todas las etapas</option>
          {funnelOptions.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        {(search || filterPlatform || filterFunnel) && (
          <button
            onClick={() => {
              setSearch("");
              setFilterPlatform("");
              setFilterFunnel("");
              setPage(0);
            }}
            className="text-xs text-gray-400 hover:text-white"
          >
            Limpiar filtros
          </button>
        )}
        <span className="text-xs text-gray-500">
          {total} contacto{total !== 1 ? "s" : ""}
        </span>
      </div>

      {/* New contact form */}
      {showNewForm && (
        <form
          onSubmit={handleCreateContact}
          className="flex items-end gap-3 border-b border-gray-800 bg-gray-900/50 px-6 py-4"
        >
          <div className="flex-1">
            <label className="mb-1 block text-xs text-gray-400">
              Username
            </label>
            <input
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="@username"
              required
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-400">
              Plataforma
            </label>
            <select
              value={newPlatform}
              onChange={(e) => setNewPlatform(e.target.value as PlatformType)}
              className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
            >
              {PLATFORM_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={createContact.isPending}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            Crear e iniciar conversacion
          </button>
        </form>
      )}

      {/* Contact list */}
      <div className="flex-1 overflow-y-auto">
        {contactsQuery.isLoading ? (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wider text-gray-400">
                <th className="px-6 py-3">Usuario</th>
                <th className="px-6 py-3">Plataforma</th>
                <th className="px-6 py-3">Score</th>
                <th className="px-6 py-3">Etapa</th>
                <th className="px-6 py-3">Conversaciones</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 8 }).map((_, i) => (
                <TableRowSkeleton key={i} columns={6} />
              ))}
            </tbody>
          </table>
        ) : (items as unknown[]).length === 0 ? (
          <p className="p-6 text-gray-500">
            {search || filterPlatform || filterFunnel
              ? "No se encontraron contactos con esos filtros"
              : "No hay contactos aun"}
          </p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wider text-gray-400">
                <th className="px-6 py-3">Usuario</th>
                <th className="px-6 py-3">Plataforma</th>
                <th className="px-6 py-3">Score</th>
                <th className="px-6 py-3">Etapa</th>
                <th className="px-6 py-3">Conversaciones</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {(items as any[]).map((contact: any) => (
                <tr
                  key={contact.id}
                  className="group border-b border-gray-800/50 hover:bg-gray-800/30"
                >
                  <td className="px-6 py-3 text-sm text-white">
                    @{contact.username}
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-400">
                    {contact.platformType}
                  </td>
                  <td className="px-6 py-3 text-sm text-white">
                    {contact.profile?.paymentProbability ?? 0}%
                  </td>
                  <td className="px-6 py-3">
                    <span
                      className={cn(
                        "text-sm",
                        contact.profile?.funnelStage === "vip"
                          ? "text-purple-400"
                          : contact.profile?.funnelStage === "buyer"
                            ? "text-green-400"
                            : contact.profile?.funnelStage === "hot_lead"
                              ? "text-orange-400"
                              : "text-gray-400"
                      )}
                    >
                      {contact.profile?.funnelStage ?? "cold"}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-400">
                    {contact.totalConversations}
                  </td>
                  <td className="px-6 py-3">
                    <button
                      onClick={() => setDeleteTarget({ id: contact.id, username: contact.username })}
                      className="rounded p-1 text-gray-400 transition-all hover:text-red-400"
                      title="Eliminar contacto"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {hasMore || page > 0 ? (
        <div className="flex items-center justify-between border-t border-gray-800 px-6 py-3">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-800 hover:text-white disabled:opacity-30"
          >
            Anterior
          </button>
          <span className="text-xs text-gray-500">
            Pagina {page + 1}
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasMore}
            className="rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-800 hover:text-white disabled:opacity-30"
          >
            Siguiente
          </button>
        </div>
      ) : null}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="mx-4 w-full max-w-sm rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
            <h3 className="text-base font-semibold text-white">
              Eliminar contacto
            </h3>
            <p className="mt-2 text-sm text-gray-400">
              ¿Estas seguro de que quieres eliminar a{" "}
              <span className="font-medium text-white">@{deleteTarget.username}</span>?
              Se eliminaran todas sus conversaciones, mensajes y notas.
            </p>
            <p className="mt-2 text-xs text-gray-500">
              Si el contacto ha realizado algun pago, se archivara en lugar de eliminarse.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
              >
                Cancelar
              </button>
              <button
                onClick={() => deleteContact.mutate({ id: deleteTarget.id })}
                disabled={deleteContact.isPending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleteContact.isPending ? "Eliminando..." : "Eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
