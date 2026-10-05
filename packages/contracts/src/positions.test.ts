import { describe, expect, it } from "vitest";
import { customCategoryKey, defaultPositionYield, manualPositionSchema } from "./index.js";

describe("position yield", () => {
  it("defaults to no yield and accepts % of CDI or a fixed rate", () => {
    const base = { category: "cash", name: "Conta", currentValue: 100, currency: "BRL" };
    expect(manualPositionSchema.parse(base)).toMatchObject({ yieldType: "none", yieldRate: 0 });
    expect(manualPositionSchema.parse({ ...base, yieldType: "cdi", yieldRate: 1.1 })).toMatchObject({ yieldType: "cdi", yieldRate: 1.1 });
    expect(() => manualPositionSchema.parse({ ...base, yieldType: "ipca", yieldRate: 0.06 })).toThrow();
  });

  it("suggests 100% of the CDI only for Real and the emergency reserve", () => {
    expect(defaultPositionYield("cash")).toEqual({ yieldType: "cdi", yieldRate: 1 });
    expect(defaultPositionYield("reserve")).toEqual({ yieldType: "cdi", yieldRate: 1 });
    expect(defaultPositionYield("dollar")).toEqual({ yieldType: "none", yieldRate: 0 });
    expect(defaultPositionYield("fixed_income")).toEqual({ yieldType: "none", yieldRate: 0 });
    expect(defaultPositionYield("custom_imoveis")).toEqual({ yieldType: "none", yieldRate: 0 });
  });
});

describe("position name and institution", () => {
  const base = { category: "cash", currentValue: 100, currency: "BRL" };

  it("needs only one of the two", () => {
    expect(manualPositionSchema.parse({ ...base, name: "Conta" })).toMatchObject({ name: "Conta" });
    expect(manualPositionSchema.parse({ ...base, institution: "Nubank" })).toMatchObject({ name: "", institution: "Nubank" });
    expect(manualPositionSchema.parse({ ...base, name: "  ", institution: "Wise" })).toMatchObject({ name: "", institution: "Wise" });
  });

  it("rejects a position without name and institution", () => {
    expect(() => manualPositionSchema.parse(base)).toThrow("nome ou a instituição");
    expect(() => manualPositionSchema.parse({ ...base, name: " ", institution: " " })).toThrow("nome ou a instituição");
  });
});

describe("position institution", () => {
  it("is optional, trimmed and kept short", () => {
    const base = { category: "cash", name: "Conta", currentValue: 100, currency: "BRL" };
    expect(manualPositionSchema.parse(base).institution).toBeUndefined();
    expect(manualPositionSchema.parse({ ...base, institution: "  Nubank " }).institution).toBe("Nubank");
    expect(() => manualPositionSchema.parse({ ...base, institution: "x".repeat(61) })).toThrow();
  });
});

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
