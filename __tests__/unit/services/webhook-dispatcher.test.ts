import { describe, it, expect, vi } from "vitest";

// El módulo `webhook-dispatcher` importa `@/server/queues`, que instancia
// múltiples `new Queue()` de BullMQ al cargarse y deja conexiones Redis
// vivas que vitest no puede cerrar limpiamente (provocaba "Closing rpc
// while 'onUserConsoleLog' was pending" en el teardown del worker).
// Como aquí solo testeamos `generateWebhookSignature` (función pura), el
// stub del queue evita el side-effect de import.
vi.mock("@/server/queues", () => ({
  webhookDeliveryQueue: { add: vi.fn() },
}));
// Sin resolución DNS real en los tests.
vi.mock("@/lib/ssrf", () => ({ assertPublicHttpUrl: vi.fn().mockResolvedValue(undefined) }));

import { generateWebhookSignature } from "@/server/services/webhook-dispatcher";
import { createHmac } from "crypto";

describe("Webhook Dispatcher", () => {
  describe("generateWebhookSignature", () => {
    it("produces sha256= prefixed signature", () => {
      const signature = generateWebhookSignature('{"test":true}', "secret123");
      expect(signature.startsWith("sha256=")).toBe(true);
    });

    it("produces correct HMAC-SHA256 signature", () => {
      const payload = '{"event":"contact.created","data":{}}';
      const secret = "webhook-secret-key";

      const signature = generateWebhookSignature(payload, secret);
      const expected = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");

      expect(signature).toBe(expected);
    });

    it("different payloads produce different signatures", () => {
      const secret = "same-secret";
      const sig1 = generateWebhookSignature('{"a":1}', secret);
      const sig2 = generateWebhookSignature('{"b":2}', secret);

      expect(sig1).not.toBe(sig2);
    });

    it("different secrets produce different signatures", () => {
      const payload = '{"data":"same"}';
      const sig1 = generateWebhookSignature(payload, "secret-1");
      const sig2 = generateWebhookSignature(payload, "secret-2");

      expect(sig1).not.toBe(sig2);
    });

    it("signature is deterministic", () => {
      const payload = '{"test":true}';
      const secret = "my-secret";

      const sig1 = generateWebhookSignature(payload, secret);
      const sig2 = generateWebhookSignature(payload, secret);

      expect(sig1).toBe(sig2);
    });

    it("handles empty payload", () => {
      const signature = generateWebhookSignature("", "secret");
      expect(signature.startsWith("sha256=")).toBe(true);
      expect(signature.length).toBeGreaterThan(7);
    });

    it("can be verified externally", () => {
      const payload = '{"contactId":"123","event":"contact.created"}';
      const secret = "verification-test-secret";

      const signature = generateWebhookSignature(payload, secret);
      const expectedHash = createHmac("sha256", secret).update(payload).digest("hex");

      // Simulating external verification
      const receivedHash = signature.replace("sha256=", "");
      expect(receivedHash).toBe(expectedHash);
    });
  });
});

describe("resolveWebhookSecret", () => {
  it("descifra un secreto cifrado y deja tal cual uno legado", async () => {
    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "0".repeat(64);
    const { encrypt } = await import("@/lib/crypto");
    const { resolveWebhookSecret } = await import("@/server/services/webhook-dispatcher");
    expect(resolveWebhookSecret(encrypt("abc123"))).toBe("abc123");
    expect(resolveWebhookSecret("legacy-plain")).toBe("legacy-plain");
  });
});

describe("deliverWebhook headers", () => {
  it("envía las cabeceras FlowFan y las legacy FanFlow con la misma firma", async () => {
    const { deliverWebhook } = await import("@/server/services/webhook-dispatcher");
    const chain = {
      values: () => chain,
      returning: async () => [{ id: "log-1" }],
      set: () => chain,
      where: async () => undefined,
    };
    const db = { insert: () => chain, update: () => chain };
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await deliverWebhook(db as never, "cfg-1", "contact.created", { a: 1 }, "https://example.com/hook", "s3cret", 1);

    const headers = fetchMock.mock.calls[0]![1].headers as Record<string, string>;
    const expected = generateWebhookSignature(JSON.stringify({ a: 1 }), "s3cret");
    expect(headers["X-FlowFan-Signature"]).toBe(expected);
    expect(headers["X-FanFlow-Signature"]).toBe(expected);
    expect(headers["X-FlowFan-Event"]).toBe("contact.created");
    expect(headers["X-FanFlow-Event"]).toBe("contact.created");
    vi.unstubAllGlobals();
  });
});
