import { describe, expect, it } from "vitest";
import { slugifyFieldKey, slugifyFormSlug } from "./slug";

describe("slugifyFieldKey", () => {
  it("lowercases and replaces spaces with underscores", () => {
    expect(slugifyFieldKey("Nome do Cliente")).toBe("nome_do_cliente");
  });

  it("strips pt-BR accents", () => {
    expect(slugifyFieldKey("Endereço da Região")).toBe("endereco_da_regiao");
    expect(slugifyFieldKey("São Paulo")).toBe("sao_paulo");
  });

  it("collapses non-alphanumeric runs and trims edges", () => {
    expect(slugifyFieldKey("  Qual é o seu e-mail?!  ")).toBe("qual_e_o_seu_e_mail");
  });

  it("falls back to a default when the label has no usable characters", () => {
    expect(slugifyFieldKey("???")).toBe("campo");
    expect(slugifyFieldKey("")).toBe("campo");
  });
});

describe("slugifyFormSlug", () => {
  it("hyphenates instead of underscoring", () => {
    expect(slugifyFormSlug("Cadastro de Interessados")).toBe("cadastro-de-interessados");
  });

  it("falls back to a default when the name has no usable characters", () => {
    expect(slugifyFormSlug("!!!")).toBe("formulario");
  });
});
