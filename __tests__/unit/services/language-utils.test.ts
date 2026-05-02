import { describe, it, expect } from "vitest";
import {
  SUPPORTED_LANGUAGES,
  getLanguageLabel,
  isValidLanguageCode,
  getLanguageInstruction,
  getAnalysisLanguageInstruction,
} from "@/server/services/language-utils";

describe("language-utils", () => {
  describe("SUPPORTED_LANGUAGES", () => {
    it("contains all 6 supported languages", () => {
      expect(SUPPORTED_LANGUAGES).toHaveLength(6);
      const codes = SUPPORTED_LANGUAGES.map((l) => l.code);
      expect(codes).toEqual(["es", "en", "pt", "fr", "de", "it"]);
    });
  });

  describe("getLanguageLabel", () => {
    it("returns the correct label for each supported code", () => {
      expect(getLanguageLabel("es")).toBe("Español");
      expect(getLanguageLabel("en")).toBe("English");
      expect(getLanguageLabel("pt")).toBe("Português");
      expect(getLanguageLabel("fr")).toBe("Français");
      expect(getLanguageLabel("de")).toBe("Deutsch");
      expect(getLanguageLabel("it")).toBe("Italiano");
    });

    it("returns the code itself for unsupported languages", () => {
      expect(getLanguageLabel("ja")).toBe("ja");
      expect(getLanguageLabel("xyz")).toBe("xyz");
    });
  });

  describe("isValidLanguageCode", () => {
    it("returns true for all supported codes", () => {
      for (const lang of SUPPORTED_LANGUAGES) {
        expect(isValidLanguageCode(lang.code)).toBe(true);
      }
    });

    it("returns false for unsupported codes", () => {
      expect(isValidLanguageCode("ja")).toBe(false);
      expect(isValidLanguageCode("")).toBe(false);
      expect(isValidLanguageCode("ES")).toBe(false);
    });
  });

  describe("getLanguageInstruction", () => {
    it("returns instruction with the correct label for a supported code", () => {
      expect(getLanguageInstruction("es")).toBe(
        "IDIOMA DE RESPUESTA: Responde siempre en Español. Todas las variantes deben estar en Español."
      );
    });

    it("falls back to the raw code when the language is unsupported", () => {
      expect(getLanguageInstruction("ja")).toBe(
        "IDIOMA DE RESPUESTA: Responde siempre en ja. Todas las variantes deben estar en ja."
      );
    });
  });

  describe("getAnalysisLanguageInstruction", () => {
    it("returns analysis instruction with the correct label", () => {
      expect(getAnalysisLanguageInstruction("fr")).toBe(
        "Genera todos los campos de texto libre (emotionalTone, summary, etc.) en Français."
      );
    });

    it("falls back to the raw code when the language is unsupported", () => {
      expect(getAnalysisLanguageInstruction("unknown")).toBe(
        "Genera todos los campos de texto libre (emotionalTone, summary, etc.) en unknown."
      );
    });
  });
});
