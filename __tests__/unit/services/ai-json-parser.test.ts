import { describe, it, expect } from "vitest";
import { parseTolerantJSON } from "@/server/services/ai-json-parser";

describe("parseTolerantJSON", () => {
  it("parses plain JSON with no wrapping", () => {
    expect(parseTolerantJSON<{ a: number }>('{"a": 1}')).toEqual({ a: 1 });
  });

  it("parses JSON wrapped in ```json fences", () => {
    expect(parseTolerantJSON<{ a: number }>('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it("parses JSON wrapped in plain ``` fences (no language tag)", () => {
    expect(parseTolerantJSON<{ a: number }>('```\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it("strips a closed <think> block before the JSON", () => {
    expect(parseTolerantJSON<{ a: number }>('<think>razonando...</think>{"a": 1}')).toEqual({ a: 1 });
  });

  it("strips an UNCLOSED <think> block (truncated reasoner response) — AI-4", () => {
    // Si el <think> nunca se cierra porque la respuesta se truncó, no debe
    // quedar basura que rompa el parseo del resto (que en este caso, de
    // hecho, tampoco tiene JSON — debe devolver null, no lanzar).
    expect(parseTolerantJSON("<think>razonando y me corto")).toBeNull();
  });

  it("prefers the content INSIDE a fence over stray braces outside it", () => {
    const text = 'Aquí va algo raro con llaves {no es json} pero el real está en:\n```json\n{"a": 1}\n```\nfin';
    expect(parseTolerantJSON<{ a: number }>(text)).toEqual({ a: 1 });
  });

  it("returns null when there is no JSON object at all", () => {
    expect(parseTolerantJSON("solo texto plano, sin llaves")).toBeNull();
  });

  it("returns null on malformed JSON inside the braces", () => {
    expect(parseTolerantJSON('{"a": }')).toBeNull();
  });

  it("returns null on empty string", () => {
    expect(parseTolerantJSON("")).toBeNull();
  });

  it("tolerates leading/trailing prose around the JSON object", () => {
    const text = 'Aquí tienes el resultado:\n{"a": 1, "b": "hola"}\nEspero que ayude.';
    expect(parseTolerantJSON<{ a: number; b: string }>(text)).toEqual({ a: 1, b: "hola" });
  });
});
