"use client";

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

/** base64url (VAPID public key) → Uint8Array para pushManager.subscribe. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export function PushToggle() {
  const configQuery = trpc.push.getConfig.useQuery();
  const subscribeMut = trpc.push.subscribe.useMutation();
  const unsubscribeMut = trpc.push.unsubscribe.useMutation();

  const [supported, setSupported] = useState(false);
  const [subscribedHere, setSubscribedHere] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const ok =
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    setSupported(ok);
    if (!ok) return;
    // ¿Este navegador ya está suscrito?
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscribedHere(!!sub))
      .catch(() => {});
  }, []);

  const config = configQuery.data;

  async function enable() {
    setError("");
    setBusy(true);
    try {
      if (!config?.publicKey) throw new Error("Push no configurado en el servidor.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error("Permiso de notificaciones denegado.");
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.publicKey) as BufferSource,
      });
      const json = sub.toJSON();
      await subscribeMut.mutateAsync({
        endpoint: sub.endpoint,
        p256dh: json.keys?.p256dh ?? "",
        auth: json.keys?.auth ?? "",
        userAgent: navigator.userAgent.slice(0, 500),
      });
      setSubscribedHere(true);
      configQuery.refetch();
    } catch (e: any) {
      setError(e.message ?? "No se pudo activar.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setError("");
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await unsubscribeMut.mutateAsync({ endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setSubscribedHere(false);
      configQuery.refetch();
    } catch (e: any) {
      setError(e.message ?? "No se pudo desactivar.");
    } finally {
      setBusy(false);
    }
  }

  if (configQuery.isLoading) return null;

  // El servidor no tiene VAPID configurado → no ofrecemos push.
  if (!config?.enabled) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <h4 className="text-sm font-medium text-white">Notificaciones push</h4>
        <p className="mt-1 text-sm text-gray-500">
          Las notificaciones push no están habilitadas en este servidor.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium text-white">Notificaciones push</h4>
          <p className="mt-1 text-sm text-gray-400">
            Recibe avisos de nuevos mensajes y alertas aunque no tengas FanFlow
            abierto. Actívalas en cada navegador o dispositivo.
          </p>
        </div>
        {supported ? (
          subscribedHere ? (
            <button
              onClick={disable}
              disabled={busy}
              className="flex-shrink-0 rounded-lg border border-gray-700 px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-800 disabled:opacity-50"
            >
              {busy ? "…" : "Desactivar"}
            </button>
          ) : (
            <button
              onClick={enable}
              disabled={busy}
              className="flex-shrink-0 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {busy ? "Activando…" : "Activar"}
            </button>
          )
        ) : (
          <span className="text-xs text-gray-500">No soportado aquí</span>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      {config.subscribedDevices > 0 && (
        <p className="mt-2 text-xs text-gray-500">
          {config.subscribedDevices} dispositivo(s) suscrito(s) a tu cuenta.
        </p>
      )}
    </div>
  );
}
