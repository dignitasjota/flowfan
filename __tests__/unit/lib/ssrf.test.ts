import { describe, it, expect } from "vitest";
import { isPrivateIp, assertPublicHttpUrl } from "@/lib/ssrf";

describe("isPrivateIp", () => {
  it("bloquea loopback, privadas, link-local y metadata", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // metadata cloud
      "0.0.0.0",
      "100.64.0.1", // CGNAT
      "::1",
      "fe80::1",
      "fc00::1",
      "fd12::34",
      "::ffff:127.0.0.1", // IPv4 mapeada
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("permite IPs públicas", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2001:4860:4860::8888"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });
});

describe("assertPublicHttpUrl", () => {
  it("rechaza esquemas no http(s)", async () => {
    await expect(assertPublicHttpUrl("ftp://example.com")).rejects.toThrow();
    await expect(assertPublicHttpUrl("file:///etc/passwd")).rejects.toThrow();
  });

  it("rechaza IPs literales privadas sin tocar DNS", async () => {
    await expect(assertPublicHttpUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow();
    await expect(assertPublicHttpUrl("http://127.0.0.1:5432")).rejects.toThrow();
    await expect(assertPublicHttpUrl("http://[::1]/")).rejects.toThrow();
  });

  it("rechaza URLs malformadas", async () => {
    await expect(assertPublicHttpUrl("not a url")).rejects.toThrow();
  });
});
