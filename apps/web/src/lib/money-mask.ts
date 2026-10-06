// Máscara de valores em dinheiro no padrão pt-BR ("10.000,50"). O texto exibido é
// só apresentação: o valor "canônico" trafegado pelos formulários continua sendo a
// string numérica com ponto decimal ("10000.5"), que Number() entende.

const SIGNIFICANT = /[\d,]/;

function group(int: string) {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Normaliza um texto digitado: milhar com ponto, vírgula decimal, até `maxDecimals` casas. */
export function maskMoneyText(raw: string, maxDecimals = 2): { text: string; value: string } {
  const commaAt = maxDecimals > 0 ? raw.indexOf(",") : -1;
  const intDigits = (commaAt === -1 ? raw : raw.slice(0, commaAt)).replace(/\D/g, "");
  const fracDigits = commaAt === -1 ? "" : raw.slice(commaAt + 1).replace(/\D/g, "").slice(0, maxDecimals);
  const int = intDigits.replace(/^0+(?=\d)/, "");
  if (!int && commaAt === -1) return { text: "", value: "" };
  const intOut = int || "0";
  return {
    text: group(intOut) + (commaAt === -1 ? "" : `,${fracDigits}`),
    value: fracDigits ? `${intOut}.${fracDigits}` : intOut
  };
}

/** Texto exibido para um valor canônico; com fração, completa os centavos ("1.234,50"). */
export function formatMoneyValue(value: string | number | null | undefined, maxDecimals = 2): string {
  if (value === "" || value == null) return "";
  const number = Math.abs(Number(value));
  if (!Number.isFinite(number)) return "";
  let plain = number.toFixed(maxDecimals);
  if (plain.includes(".")) plain = plain.replace(/0+$/, "").replace(/\.$/, "");
  const [int = "", frac = ""] = plain.split(".");
  const cents = frac && maxDecimals >= 2 ? frac.padEnd(2, "0") : frac;
  return maskMoneyText(cents ? `${int},${cents}` : int, maxDecimals).text;
}

/**
 * Aplica uma edição do usuário (`raw` com o cursor em `caret`) sobre o texto anterior
 * e devolve o novo texto mascarado, o valor canônico e onde recolocar o cursor.
 */
export function applyMoneyEdit(
  prev: string,
  raw: string,
  caret: number,
  inputType: string,
  maxDecimals = 2
): { text: string; value: string; caret: number } {
  let next = raw;
  let at = caret;
  const delta = raw.length - prev.length;
  if (maxDecimals > 0 && delta === 1 && raw[at - 1] === "." && !prev.includes(",")) {
    // ponto digitado (teclado numérico, hábito en-US) vira a vírgula decimal
    next = `${raw.slice(0, at - 1)},${raw.slice(at)}`;
  } else if (maxDecimals > 0 && delta > 1 && !raw.includes(",")) {
    // valor colado como "1234.56": um único ponto que não separa milhar é o decimal
    const dot = raw.lastIndexOf(".");
    if (dot !== -1 && raw.indexOf(".") === dot && raw.slice(dot + 1).replace(/\D/g, "").length !== 3) {
      next = `${raw.slice(0, dot)},${raw.slice(dot + 1)}`;
    }
  } else if (delta === -1 && prev[at] === "." && raw === prev.slice(0, at) + prev.slice(at + 1)) {
    // apagar só o separador de milhar não faria nada (a máscara o recoloca): apaga o dígito vizinho
    if (inputType === "deleteContentForward") {
      next = raw.slice(0, at) + raw.slice(at + 1);
    } else if (at > 0) {
      next = raw.slice(0, at - 1) + raw.slice(at);
      at -= 1;
    }
  }

  const { text, value } = maskMoneyText(next, maxDecimals);
  // o cursor fica antes do mesmo número de dígitos que tinha à direita (a máscara mexe à esquerda)
  const after = [...next.slice(at)].filter((char) => SIGNIFICANT.test(char)).length;
  let pos = text.length;
  let seen = 0;
  while (pos > 0 && seen < after) {
    pos -= 1;
    if (SIGNIFICANT.test(text[pos] ?? "")) seen += 1;
  }
  return { text, value, caret: pos };
}
