"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { signOut } from "next-auth/react";

export function EmailVerificationGate({ email }: { email: string }) {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const resend = trpc.account.resendVerification.useMutation({
    onSuccess: (res) => {
      setError("");
      if (res.alreadyVerified) {
        // Ya estaba verificado en otra pestaña: recargar para entrar.
        window.location.reload();
        return;
      }
      setSent(true);
    },
    onError: (err) => setError(err.message ?? "No se pudo reenviar el email."),
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-gray-900 p-8 text-center shadow-xl">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-500/10 text-2xl">
          ✉️
        </div>
        <h1 className="text-xl font-semibold text-white">Verifica tu email</h1>
        <p className="mt-2 text-sm text-gray-400">
          Te hemos enviado un enlace de verificación a{" "}
          <span className="font-medium text-gray-200">{email}</span>. Haz clic en
          el enlace para activar tu cuenta y acceder a FanFlow.
        </p>

        {sent && (
          <p className="mt-4 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
            Email reenviado. Revisa tu bandeja de entrada (y la carpeta de spam).
          </p>
        )}
        {error && (
          <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="mt-6 space-y-3">
          <button
            onClick={() => resend.mutate()}
            disabled={resend.isPending}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {resend.isPending ? "Reenviando…" : "Reenviar email de verificación"}
          </button>
          <button
            onClick={() => window.location.reload()}
            className="w-full rounded-lg border border-gray-700 px-4 py-2.5 text-sm font-medium text-gray-200 transition hover:bg-gray-800"
          >
            Ya lo verifiqué — recargar
          </button>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="w-full px-4 py-2 text-sm text-gray-500 transition hover:text-gray-300"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}
