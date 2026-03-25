"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Image from "next/image";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const formData = new FormData(e.currentTarget);
    const result = await signIn("credentials", {
      email: formData.get("email") as string,
      password: formData.get("password") as string,
      redirect: false,
    });

    if (result?.error) {
      setError("Email o contraseña incorrectos");
      setLoading(false);
    } else {
      router.push("/conversations");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950">
      <div className="w-full max-w-md rounded-xl bg-gray-900 p-8 shadow-xl">
        <div className="mb-6 flex justify-center">
          <Image src="/logo.png" alt="FanFlow Logo" width={80} height={80} className="rounded-2xl" />
        </div>
        <h1 className="mb-2 text-center text-2xl font-bold text-white">
          FanFlow
        </h1>
        <p className="mb-8 text-center text-sm text-gray-400">
          CRM inteligente para creadores
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-gray-300">Email</label>
            <input
              name="email"
              type="email"
              required
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
              placeholder="tu@email.com"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-300">
              Contraseña
            </label>
            <input
              name="password"
              type="password"
              required
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
              placeholder="••••••••"
            />
          </div>

          <div className="text-right">
            <a
              href="/forgot-password"
              className="text-xs text-gray-400 hover:text-indigo-400"
            >
              Olvidaste tu contrasena?
            </a>
          </div>

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-indigo-600 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? "Entrando..." : "Iniciar sesión"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-400">
          ¿No tienes cuenta?{" "}
          <a href="/register" className="text-indigo-400 hover:text-indigo-300">
            Regístrate
          </a>
        </p>
      </div>
    </div>
  );
}
