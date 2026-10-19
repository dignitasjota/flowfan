import { describe, it, expect } from "vitest";
import { toCsvCell, toCsv } from "@/lib/csv";
import { escapeHtml } from "@/lib/html-escape";

describe("toCsvCell", () => {
  it("escapa comillas", () => {
    expect(toCsvCell('a"b')).toBe('"a""b"');
  });
  it("neutraliza fórmulas", () => {
    expect(toCsvCell("=HYPERLINK(\"x\")")).toBe('"\'=HYPERLINK(""x"")"');
    expect(toCsvCell("+1")).toBe('"\'+1"');
    expect(toCsvCell("@SUM")).toBe('"\'@SUM"');
  });
  it("null/undefined → vacío", () => {
    expect(toCsvCell(null)).toBe('""');
  });
  it("toCsv genera cabecera y filas", () => {
    expect(toCsv(["a", "b"], [{ a: 1, b: "x" }])).toBe('"a","b"\n"1","x"');
  });
});

describe("escapeHtml", () => {
  it("escapa caracteres peligrosos", () => {
    expect(escapeHtml(`<img src=x onerror="a">&'`)).toBe(
      "&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;"
    );
  });
});
