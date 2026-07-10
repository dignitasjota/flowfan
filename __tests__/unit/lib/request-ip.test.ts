import { describe, it, expect, afterEach } from "vitest";
import { getClientIp } from "@/lib/request-ip";

function reqWith(headers: Record<string, string>): Request {
  return new Request("http://localhost/", { headers });
}

afterEach(() => {
  delete process.env.TRUSTED_PROXY_HOPS;
});

describe("getClientIp (SEC-4)", () => {
  it("toma el primer valor de X-Forwarded-For por defecto", () => {
    expect(getClientIp(reqWith({ "x-forwarded-for": "1.2.3.4" }))).toBe("1.2.3.4");
    expect(getClientIp(reqWith({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
  });

  it("con TRUSTED_PROXY_HOPS cuenta desde la derecha", () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    // client, proxy1 → la IP puesta por el proxy más externo es la última
    expect(getClientIp(reqWith({ "x-forwarded-for": "fake, 9.9.9.9" }))).toBe("9.9.9.9");
  });

  it("cae a x-real-ip si no hay XFF", () => {
    expect(getClientIp(reqWith({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
  });

  it("devuelve 'unknown' sin cabeceras", () => {
    expect(getClientIp(reqWith({}))).toBe("unknown");
  });
});
