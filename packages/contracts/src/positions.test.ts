import { describe, expect, it } from "vitest";
import { customCategoryKey, manualPositionSchema } from "./index.js";

describe("customCategoryKey", () => {
  it("builds an accent-free key from the typed name", () => {
    expect(customCategoryKey(" Imóveis ")).toBe("custom_imoveis");
    expect(customCategoryKey("Previdência Privada (PGBL)")).toBe("custom_previdencia_privada_pgbl");
    expect(customCategoryKey("Ações & Fundos")).toBe("custom_acoes_fundos");
    expect(customCategoryKey("!!!")).toBeNull();
  });
});

describe("manualPositionSchema", () => {
  const position = { name: "Conta", currentValue: 100, currency: "BRL" };

  it("accepts the built-in categories and custom_ keys", () => {
    expect(manualPositionSchema.parse({ ...position, category: "cash" }).category).toBe("cash");
    expect(manualPositionSchema.parse({ ...position, category: "custom_imoveis" }).category).toBe("custom_imoveis");
  });

  it("rejects unknown categories", () => {
    expect(() => manualPositionSchema.parse({ ...position, category: "imoveis" })).toThrow();
    expect(() => manualPositionSchema.parse({ ...position, category: "custom_" })).toThrow();
    expect(() => manualPositionSchema.parse({ ...position, category: "custom_Imóveis" })).toThrow();
  });
});
