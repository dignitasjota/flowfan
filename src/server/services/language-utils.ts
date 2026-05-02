export const SUPPORTED_LANGUAGES = [
  { code: "es", label: "Español" },
  { code: "en", label: "English" },
  { code: "pt", label: "Português" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

const languageMap = new Map<string, string>(
  SUPPORTED_LANGUAGES.map((l) => [l.code, l.label])
);

export function getLanguageLabel(code: string): string {
  return languageMap.get(code) ?? code;
}

export function isValidLanguageCode(code: string): code is LanguageCode {
  return languageMap.has(code);
}

export function getLanguageInstruction(code: string): string {
  const label = getLanguageLabel(code);
  return `IDIOMA DE RESPUESTA: Responde siempre en ${label}. Todas las variantes deben estar en ${label}.`;
}

export function getAnalysisLanguageInstruction(code: string): string {
  const label = getLanguageLabel(code);
  return `Genera todos los campos de texto libre (emotionalTone, summary, etc.) en ${label}.`;
}
