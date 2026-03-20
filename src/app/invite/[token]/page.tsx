"use client";

import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc";
import { useState } from "react";

export default function InvitePage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;
  const { data: session, status: sessionStatus } = useSession();
  const [accepted, setAccepted] = useState(false);

  const acceptInvite = trpc.team.acceptInvite.useMutation({
    onSuccess: () => {
      setAccepted(true);
      setTimeout(() => router.push("/conversations"), 1500);
    },
  });

  const handleAccept = () => {
    acceptInvite.mutate({ token });
  };

  const currentPath = typeof window !== "undefined" ? window.location.pathname : `/invite/${token}`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-900 p-8">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-white">FanFlow</h1>
          <p className="mt-1 text-sm text-gray-400">Invitacion de equipo</p>
        </div>

        {accepted ? (
          <div className="text-center">
            <div className="mb-3 text-3xl">&#10003;</div>
            <h2 className="text-lg font-semibold text-white">
              Invitacion aceptada
            </h2>
            <p className="mt-2 text-sm text-gray-400">
              Redirigiendo a conversaciones...
            </p>
          </div>
        ) : sessionStatus === "loading" ? (
          <div className="flex justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-700 border-t-indigo-500" />
          </div>
        ) : session ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-gray-300">
              Has sido invitado a unirte a un equipo en FanFlow como{" "}
              <span className="font-medium text-white">
                {session.user?.name ?? session.user?.email}
              </span>
              .
            </p>

            {acceptInvite.isError && (
              <div className="rounded-lg border border-red-900/50 bg-red-900/20 p-3">
                <p className="text-sm text-red-400">
                  {acceptInvite.error.message}
                </p>
              </div>
            )}

            <button
              onClick={handleAccept}
              disabled={acceptInvite.isPending}
              className="w-full rounded-lg bg-indigo-600 px-6 py-3 text-sm font-medium text-white hover:bg-indigo-500 transition-colors disabled:opacity-50"
            >
              {acceptInvite.isPending
                ? "Aceptando..."
                : "Aceptar invitacion"}
            </button>
          </div>
        ) : (
          <div className="space-y-4 text-center">
            <p className="text-sm text-gray-300">
              Necesitas iniciar sesion para aceptar esta invitacion.
            </p>
            <a
              href={`/login?callbackUrl=${encodeURIComponent(currentPath)}`}
              className="inline-block w-full rounded-lg bg-indigo-600 px-6 py-3 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
            >
              Iniciar sesion
            </a>
            <p className="text-xs text-gray-500">
              Si no tienes cuenta, puedes registrarte y luego volver a este
              enlace.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
