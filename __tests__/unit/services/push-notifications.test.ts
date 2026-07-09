import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// web-push se mockea para no cargar el módulo nativo ni enviar nada real.
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn().mockResolvedValue(undefined),
    generateVAPIDKeys: vi.fn(),
  },
}));

const ORIGINAL = { ...process.env };

beforeEach(() => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.resetModules();
});

describe("isPushConfigured / getVapidPublicKey", () => {
  it("no está configurado si faltan las VAPID keys", async () => {
    const mod = await import("@/server/services/push-notifications");
    expect(mod.isPushConfigured()).toBe(false);
    expect(mod.getVapidPublicKey()).toBeNull();
  });

  it("está configurado cuando las 3 variables están presentes", async () => {
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    process.env.VAPID_SUBJECT = "mailto:a@b.com";
    const mod = await import("@/server/services/push-notifications");
    expect(mod.isPushConfigured()).toBe(true);
    expect(mod.getVapidPublicKey()).toBe("pub");
  });

  it("no está configurado si falta el subject", async () => {
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    const mod = await import("@/server/services/push-notifications");
    expect(mod.isPushConfigured()).toBe(false);
  });
});

describe("sendPushToCreator", () => {
  it("es no-op (0 enviados) si push no está configurado", async () => {
    const mod = await import("@/server/services/push-notifications");
    const db = { query: { pushSubscriptions: { findMany: vi.fn() } } };
    const res = await mod.sendPushToCreator(db as any, "c1", {
      title: "t",
      body: "b",
    });
    expect(res).toEqual({ sent: 0, removed: 0 });
    // No debe ni consultar las suscripciones si no está configurado.
    expect(db.query.pushSubscriptions.findMany).not.toHaveBeenCalled();
  });
});
