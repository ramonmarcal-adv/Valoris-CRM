import { describe, expect, it } from "vitest";
import { interpolate } from "./template";

describe("interpolate", () => {
  it("substitutes bare {{key}} placeholders", () => {
    expect(interpolate("{{nome}} - {{cidade}}", { nome: "Ana", cidade: "São Paulo" })).toBe("Ana - São Paulo");
  });

  it("tolerates whitespace inside braces", () => {
    expect(interpolate("{{ nome }}", { nome: "Ana" })).toBe("Ana");
  });

  it("renders missing keys as empty string", () => {
    expect(interpolate("{{nome}} - {{cidade}}", { nome: "Ana" })).toBe("Ana - ");
  });

  it("leaves non-placeholder text untouched", () => {
    expect(interpolate("Novo lead: {{nome}}", { nome: "Ana" })).toBe("Novo lead: Ana");
  });

  it("returns an empty string for an empty template", () => {
    expect(interpolate("", { nome: "Ana" })).toBe("");
  });

  it("leaves a dotted/namespaced placeholder literal — bare [a-zA-Z0-9_]+ keys only, by design", () => {
    expect(interpolate("{{vars.nome}}", { "vars.nome": "Ana" })).toBe("{{vars.nome}}");
  });
});
