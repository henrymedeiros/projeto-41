import { describe, expect, it } from "vitest";
import { applyMoneyEdit, formatMoneyValue, maskMoneyText } from "./money-mask.js";

describe("maskMoneyText", () => {
  it("agrupa milhares com ponto e usa vírgula decimal", () => {
    expect(maskMoneyText("10000")).toEqual({ text: "10.000", value: "10000" });
    expect(maskMoneyText("1234567,89")).toEqual({ text: "1.234.567,89", value: "1234567.89" });
  });

  it("mantém a vírgula durante a digitação", () => {
    expect(maskMoneyText("10,")).toEqual({ text: "10,", value: "10" });
    expect(maskMoneyText(",")).toEqual({ text: "0,", value: "0" });
  });

  it("descarta letras, zeros à esquerda e casas além do limite", () => {
    expect(maskMoneyText("00a12b")).toEqual({ text: "12", value: "12" });
    expect(maskMoneyText("1,999")).toEqual({ text: "1,99", value: "1.99" });
    expect(maskMoneyText("0,00012345", 8)).toEqual({ text: "0,00012345", value: "0.00012345" });
  });

  it("devolve vazio sem dígitos", () => {
    expect(maskMoneyText("")).toEqual({ text: "", value: "" });
    expect(maskMoneyText("abc")).toEqual({ text: "", value: "" });
  });
});

describe("formatMoneyValue", () => {
  it("formata o valor canônico, completando os centavos", () => {
    expect(formatMoneyValue("10000")).toBe("10.000");
    expect(formatMoneyValue(1234.5)).toBe("1.234,50");
    expect(formatMoneyValue("0.00012345", 8)).toBe("0,00012345");
  });

  it("arredonda ao limite de casas e aceita notação científica", () => {
    expect(formatMoneyValue(123.45678)).toBe("123,46");
    expect(formatMoneyValue(1e-7, 8)).toBe("0,0000001");
  });

  it("devolve vazio para valores vazios ou inválidos", () => {
    expect(formatMoneyValue("")).toBe("");
    expect(formatMoneyValue("abc")).toBe("");
  });
});

describe("applyMoneyEdit", () => {
  it("reformata e mantém o cursor depois do dígito digitado", () => {
    expect(applyMoneyEdit("1.000", "1.0000", 6, "insertText")).toEqual({
      text: "10.000",
      value: "10000",
      caret: 6
    });
    expect(applyMoneyEdit("1.000", "19.000", 2, "insertText")).toMatchObject({ text: "19.000", caret: 3 });
  });

  it("trata o ponto digitado como vírgula decimal", () => {
    expect(applyMoneyEdit("10", "10.", 3, "insertText")).toEqual({ text: "10,", value: "10", caret: 3 });
    expect(applyMoneyEdit("10,5", "10,5.", 5, "insertText")).toMatchObject({ text: "10,5" });
  });

  it("entende um valor colado com ponto decimal", () => {
    expect(applyMoneyEdit("", "1234.56", 7, "insertFromPaste")).toMatchObject({ text: "1.234,56", value: "1234.56" });
    expect(applyMoneyEdit("", "1.234", 5, "insertFromPaste")).toMatchObject({ text: "1.234", value: "1234" });
  });

  it("apagar o separador de milhar apaga o dígito vizinho", () => {
    expect(applyMoneyEdit("1.000", "1000", 1, "deleteContentBackward")).toEqual({
      text: "0",
      value: "0",
      caret: 0
    });
    expect(applyMoneyEdit("12.345", "12345", 2, "deleteContentBackward")).toMatchObject({ text: "1.345", caret: 2 });
    expect(applyMoneyEdit("12.345", "12345", 2, "deleteContentForward")).toMatchObject({ text: "1.245", caret: 3 });
  });
});
