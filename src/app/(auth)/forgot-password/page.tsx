"use client";

import { useState } from "react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    setSent(true);
    setLoading(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950">
      <div className="w-full max-w-md rounded-xl bg-gray-900 p-8 shadow-xl">
        <h1 className="mb-2 text-center text-2xl font-bold text-white">
          Recuperar contrasena
        </h1>

        {sent ? (
          <div className="space-y-4">
            <p className="text-center text-sm text-gray-300">
              Si existe una cuenta con ese email, recibirás un enlace para
              restablecer tu contrasena.
            </p>
            <p className="text-center text-xs text-gray-500">
              Revisa tu bandeja de entrada y la carpeta de spam.
            </p>
            <a
              href="/login"
              className="block text-center text-sm text-indigo-400 hover:text-indigo-300"
            >
              Volver al login
            </a>
          </div>
        ) : (
          <>
            <p className="mb-8 text-center text-sm text-gray-400">
              Introduce tu email y te enviaremos un enlace para restablecer tu
              contrasena.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm text-gray-300">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
                  placeholder="tu@email.com"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-indigo-600 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {loading ? "Enviando..." : "Enviar enlace"}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-gray-400">
              <a
                href="/login"
                className="text-indigo-400 hover:text-indigo-300"
              >
                Volver al login
              </a>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
