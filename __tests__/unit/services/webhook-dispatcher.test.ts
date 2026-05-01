import { describe, it, expect } from "vitest";
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
