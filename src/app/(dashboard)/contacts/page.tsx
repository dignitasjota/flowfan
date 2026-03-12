"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const platformOptions = [
  { value: "instagram", label: "Instagram" },
  { value: "tinder", label: "Tinder" },
  { value: "reddit", label: "Reddit" },
  { value: "onlyfans", label: "OnlyFans" },
  { value: "twitter", label: "Twitter" },
  { value: "telegram", label: "Telegram" },
  { value: "snapchat", label: "Snapchat" },
  { value: "other", label: "Otra" },
] as const;

type PlatformType = (typeof platformOptions)[number]["value"];

export default function ContactsPage() {
  const [showNewForm, setShowNewForm] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPlatform, setNewPlatform] = useState<PlatformType>("instagram");

  const contactsQuery = trpc.contacts.list.useQuery();
  const createContact = trpc.contacts.create.useMutation({
    onSuccess: () => {
      contactsQuery.refetch();
      setShowNewForm(false);
      setNewUsername("");
    },
  });

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

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
        <h2 className="text-lg font-semibold text-white">Contactos</h2>
        <button
          onClick={() => setShowNewForm(!showNewForm)}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          + Nuevo contacto
        </button>
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
              {platformOptions.map((p) => (
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
            Crear e iniciar conversación
          </button>
        </form>
      )}

      {/* Contact list */}
      <div className="flex-1 overflow-y-auto">
        {contactsQuery.isLoading ? (
          <p className="p-6 text-gray-500">Cargando...</p>
        ) : contactsQuery.data?.length === 0 ? (
          <p className="p-6 text-gray-500">No hay contactos aún</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wider text-gray-400">
                <th className="px-6 py-3">Usuario</th>
                <th className="px-6 py-3">Plataforma</th>
                <th className="px-6 py-3">Score</th>
                <th className="px-6 py-3">Etapa</th>
                <th className="px-6 py-3">Conversaciones</th>
              </tr>
            </thead>
            <tbody>
              {contactsQuery.data?.map((contact) => (
                <tr
                  key={contact.id}
                  className="border-b border-gray-800/50 hover:bg-gray-800/30"
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
