import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { extractContent } from "@/server/services/blog-to-social";

describe("blog-to-social extractContent", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
  });

  function mockFetch(html: string, status = 200) {
    global.fetch = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      body: {
        getReader() {
          let sent = false;
          return {
            async read() {
              if (sent) return { done: true, value: undefined };
              sent = true;
              return {
                done: false,
                value: new TextEncoder().encode(html),
              };
            },
            async cancel() {},
          };
        },
      },
    }) as typeof global.fetch;
  }

  it("extracts title from <title>", async () => {
    mockFetch(
      `<html><head><title>Mi artículo</title></head><body><article><p>${"Hola ".repeat(50)}</p></article></body></html>`
    );
    const result = await extractContent("https://example.com/post");
    expect(result.title).toBe("Mi artículo");
  });

  it("prefers og:description for excerpt", async () => {
    mockFetch(
      `<html><head><meta property="og:description" content="Resumen OG"><meta name="description" content="Meta desc"></head><body><article><p>${"Texto largo. ".repeat(30)}</p></article></body></html>`
    );
    const result = await extractContent("https://example.com/post");
    expect(result.excerpt).toBe("Resumen OG");
  });

  it("falls back to meta description if no og", async () => {
    mockFetch(
      `<html><head><meta name="description" content="Meta desc"></head><body><article><p>${"Texto. ".repeat(30)}</p></article></body></html>`
    );
    const result = await extractContent("https://example.com/post");
    expect(result.excerpt).toBe("Meta desc");
  });

  it("extracts paragraphs from article", async () => {
    mockFetch(
      `<html><body><article><p>Primer párrafo con suficiente contenido para el filtro.</p><p>Segundo párrafo también con suficiente contenido para pasar el filtro.</p></article></body></html>`
    );
    const result = await extractContent("https://example.com/post");
    expect(result.content).toContain("Primer párrafo");
    expect(result.content).toContain("Segundo párrafo");
  });

  it("strips script and style tags", async () => {
    mockFetch(
      `<html><body><article><script>alert('xss')</script><p>${"Visible content. ".repeat(10)}</p><style>.x{color:red}</style></article></body></html>`
    );
    const result = await extractContent("https://example.com/post");
    expect(result.content).not.toContain("alert");
    expect(result.content).not.toContain("color:red");
    expect(result.content).toContain("Visible content");
  });

  it("decodes HTML entities", async () => {
    mockFetch(
      `<html><body><article><p>${"It&#39;s &amp; cool. ".repeat(10)}</p></article></body></html>`
    );
    const result = await extractContent("https://example.com/post");
    expect(result.content).toContain("It's & cool");
  });

  it("throws on non-2xx response", async () => {
    mockFetch("not found", 404);
    await expect(
      extractContent("https://example.com/missing")
    ).rejects.toThrow(/404/);
  });
});
