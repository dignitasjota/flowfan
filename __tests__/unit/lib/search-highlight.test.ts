import { describe, it, expect } from "vitest";
import {
  splitHighlightedSnippet,
  HIGHLIGHT_START as S,
  HIGHLIGHT_END as E,
} from "@/lib/search-highlight";

describe("splitHighlightedSnippet", () => {
  it("separa trozos resaltados y no resaltados", () => {
    expect(splitHighlightedSnippet(`hola ${S}mundo${E} feliz`)).toEqual([
      { text: "hola ", highlighted: false },
      { text: "mundo", highlighted: true },
      { text: " feliz", highlighted: false },
    ]);
  });

  it("no interpreta HTML: el contenido malicioso queda como texto", () => {
    const segs = splitHighlightedSnippet(`<img src=x onerror=alert(1)> ${S}x${E}`);
    expect(segs[0]).toEqual({ text: "<img src=x onerror=alert(1)> ", highlighted: false });
  });

  it("tolera un marcador sin cerrar", () => {
    expect(splitHighlightedSnippet(`a ${S}b`)).toEqual([
      { text: "a ", highlighted: false },
      { text: "b", highlighted: true },
    ]);
  });
});
