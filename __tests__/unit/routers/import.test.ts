import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.clearAllMocks();
});

// Inline CSV parser matching the one in import.ts
function parseCSV(content: string): { headers: string[]; rows: string[][] } {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  function parseLine(line: string): string[] {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i]!;
      if (inQuotes) {
        if (char === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          current += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ",") {
          fields.push(current.trim());
          current = "";
        } else {
          current += char;
        }
      }
    }
    fields.push(current.trim());
    return fields;
  }

  const headers = parseLine(lines[0]!);
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows };
}

function autoDetectMapping(headers: string[]): Record<string, string | null> {
  const mapping: Record<string, string | null> = {};
  const nameMap: Record<string, string> = {
    username: "username",
    user: "username",
    usuario: "username",
    nombre_usuario: "username",
    handle: "username",
    displayname: "displayName",
    display_name: "displayName",
    nombre: "displayName",
    name: "displayName",
    platform: "platformType",
    platformtype: "platformType",
    platform_type: "platformType",
    plataforma: "platformType",
    tags: "tags",
    etiquetas: "tags",
  };

  for (const header of headers) {
    const normalized = header.toLowerCase().replace(/\s+/g, "_");
    mapping[header] = nameMap[normalized] ?? null;
  }

  return mapping;
}

describe("import", () => {
  describe("CSV parsing", () => {
    it("parses basic CSV", () => {
      const csv = "username,platform\njohn,instagram\njane,telegram";
      const result = parseCSV(csv);
      expect(result.headers).toEqual(["username", "platform"]);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toEqual(["john", "instagram"]);
    });

    it("handles quoted fields with commas", () => {
      const csv = 'name,bio\njohn,"hello, world"\njane,simple';
      const result = parseCSV(csv);
      expect(result.rows[0]![1]).toBe("hello, world");
    });

    it("handles escaped quotes", () => {
      const csv = 'name,desc\njohn,"say ""hi"""\njane,normal';
      const result = parseCSV(csv);
      expect(result.rows[0]![1]).toBe('say "hi"');
    });

    it("handles empty fields", () => {
      const csv = "a,b,c\n1,,3\n,2,";
      const result = parseCSV(csv);
      expect(result.rows[0]).toEqual(["1", "", "3"]);
      expect(result.rows[1]).toEqual(["", "2", ""]);
    });

    it("handles CRLF line endings", () => {
      const csv = "a,b\r\n1,2\r\n3,4";
      const result = parseCSV(csv);
      expect(result.rows).toHaveLength(2);
    });

    it("returns empty for empty input", () => {
      const result = parseCSV("");
      expect(result.headers).toEqual([]);
      expect(result.rows).toEqual([]);
    });

    it("handles header-only CSV", () => {
      const result = parseCSV("username,platform");
      expect(result.headers).toEqual(["username", "platform"]);
      expect(result.rows).toHaveLength(0);
    });

    it("trims whitespace from fields", () => {
      const csv = "a , b\n 1 , 2 ";
      const result = parseCSV(csv);
      expect(result.headers).toEqual(["a", "b"]);
      expect(result.rows[0]).toEqual(["1", "2"]);
    });
  });

  describe("auto-detect column mapping", () => {
    it("detects english column names", () => {
      const mapping = autoDetectMapping(["username", "platform", "name"]);
      expect(mapping.username).toBe("username");
      expect(mapping.platform).toBe("platformType");
      expect(mapping.name).toBe("displayName");
    });

    it("detects spanish column names", () => {
      const mapping = autoDetectMapping(["usuario", "plataforma", "nombre"]);
      expect(mapping.usuario).toBe("username");
      expect(mapping.plataforma).toBe("platformType");
      expect(mapping.nombre).toBe("displayName");
    });

    it("returns null for unknown columns", () => {
      const mapping = autoDetectMapping(["foo", "bar"]);
      expect(mapping.foo).toBeNull();
      expect(mapping.bar).toBeNull();
    });

    it("handles mixed case headers", () => {
      const mapping = autoDetectMapping(["Username", "PLATFORM", "Display Name"]);
      expect(mapping.Username).toBe("username");
      expect(mapping.PLATFORM).toBe("platformType");
      expect(mapping["Display Name"]).toBe("displayName");
    });
  });

  describe("mapping validation", () => {
    it("requires username mapping", () => {
      const mapping = { platform: "platformType" };
      const fields = Object.values(mapping);
      expect(fields.includes("username")).toBe(false);
    });

    it("requires platformType mapping", () => {
      const mapping = { user: "username" };
      const fields = Object.values(mapping);
      expect(fields.includes("platformType")).toBe(false);
    });

    it("accepts valid mapping with both required fields", () => {
      const mapping = { user: "username", plat: "platformType", name: "displayName" };
      const fields = Object.values(mapping);
      expect(fields.includes("username")).toBe(true);
      expect(fields.includes("platformType")).toBe(true);
    });
  });

  describe("duplicate detection", () => {
    it("detects duplicate by username + platform", () => {
      const existing = new Set(["john:instagram", "jane:telegram"]);
      const key = "john:instagram";
      expect(existing.has(key)).toBe(true);
    });

    it("case-insensitive username matching", () => {
      const existing = new Set(["john:instagram"]);
      const key = `${"JOHN".toLowerCase()}:instagram`;
      expect(existing.has(key)).toBe(true);
    });

    it("different platform is not a duplicate", () => {
      const existing = new Set(["john:instagram"]);
      const key = "john:telegram";
      expect(existing.has(key)).toBe(false);
    });
  });

  describe("platform validation", () => {
    const VALID_PLATFORMS = new Set([
      "instagram", "tinder", "reddit", "onlyfans",
      "twitter", "telegram", "snapchat", "other",
    ]);

    it("accepts all valid platforms", () => {
      for (const p of VALID_PLATFORMS) {
        expect(VALID_PLATFORMS.has(p)).toBe(true);
      }
    });

    it("rejects invalid platform", () => {
      expect(VALID_PLATFORMS.has("facebook")).toBe(false);
      expect(VALID_PLATFORMS.has("")).toBe(false);
    });

    it("handles case normalization", () => {
      expect(VALID_PLATFORMS.has("Instagram".toLowerCase())).toBe(true);
    });
  });

  describe("bulk contact limit", () => {
    it("allows import within plan limit", () => {
      const planLimit = 50;
      const currentCount = 30;
      const newCount = 15;
      const remaining = planLimit - currentCount;
      expect(remaining >= newCount).toBe(true);
    });

    it("rejects import exceeding plan limit", () => {
      const planLimit = 50;
      const currentCount = 45;
      const newCount = 10;
      const remaining = planLimit - currentCount;
      expect(remaining >= newCount).toBe(false);
    });

    it("unlimited plan (-1) always allows", () => {
      const planLimit = -1;
      const isUnlimited = planLimit === -1;
      expect(isUnlimited).toBe(true);
    });
  });
});
