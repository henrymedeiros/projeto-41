export type PositionOperation = {
  type: "buy" | "sell";
  quantity: number;
  total: number;
};

export type PositionResult = {
  quantity: number;
  invested: number;
  averagePrice: number;
  soldValue: number;
  marketValue: number;
  currentReturn: number;
  totalReturn: number;
  dividends: number;
};

export function calculatePosition(
  operations: PositionOperation[],
  currentPrice: number,
  dividends = 0
): PositionResult {
  const buys = operations.filter((operation) => operation.type === "buy");
  const sells = operations.filter((operation) => operation.type === "sell");
  const boughtQuantity = sum(buys.map((operation) => operation.quantity));
  const soldQuantity = sum(sells.map((operation) => operation.quantity));
  const quantity = boughtQuantity - soldQuantity;
  const invested = sum(buys.map((operation) => operation.total));
  const averagePrice = boughtQuantity > 0 ? invested / boughtQuantity : 0;
  const soldValue = sum(sells.map((operation) => operation.total));
  const marketValue = quantity * currentPrice;

  return {
    quantity,
    invested,
    averagePrice,
    soldValue,
    marketValue,
    currentReturn: averagePrice > 0 ? currentPrice / averagePrice - 1 : 0,
    totalReturn: invested > 0 ? (marketValue + soldValue + dividends) / invested - 1 : 0,
    dividends
  };
}

export function calculateAllocation(
  total: number,
  excludedReserve: number,
  targetWeight: number
) {
  const investableTotal = total - excludedReserve;
  const ideal = investableTotal * targetWeight;
  return { investableTotal, ideal, difference: ideal };
}

export type PlanningInput = {
  initialCapital: number;
  monthlyContribution: number;
  monthlyReturnPercent: number;
  months: number;
  annualInflationPercent: number;
  initialYear: number;
};

export type PlanningYear = {
  year: number;
  annualContribution: number;
  nominalBalance: number;
  realBalance: number;
  realMonthlyIncome: number;
};

export function projectWealth(input: PlanningInput): PlanningYear[] {
  const years = Math.round(input.months / 12);
  const monthlyReturn = input.monthlyReturnPercent / 100;
  const monthlyInflation = (1 + input.annualInflationPercent / 100) ** (1 / 12) - 1;
  const result: PlanningYear[] = [];
  let nominal = input.initialCapital;

  for (let year = 1; year <= years; year += 1) {
    const correctedContribution =
      input.monthlyContribution * (1 + input.annualInflationPercent / 100) ** (year - 1);
    for (let month = 0; month < 12; month += 1) {
      nominal = nominal * (1 + monthlyReturn) + correctedContribution;
    }
    const elapsedMonths = year * 12;
    const realBalance = nominal / (1 + monthlyInflation) ** elapsedMonths;
    result.push({
      year: input.initialYear + year,
      annualContribution: correctedContribution * 12,
      nominalBalance: nominal,
      realBalance,
      realMonthlyIncome: realBalance * monthlyReturn
    });
  }

  return result;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

// ---------- rendimento ----------

/** Como uma posição rende: % do CDI (1 = 100%), prefixado (0.12 = 12% a.a.) ou nada. */
export type PositionYield = { type: "cdi" | "fixed" | "none"; rate: number };

/**
 * Rendimento efetivo ao ano (0.1365 = 13,65%). No CDI, o percentual incide sobre a taxa
 * diária (252 dias úteis), como nos títulos pós-fixados. Sem a taxa do CDI, devolve null.
 */
export function effectiveAnnualYield(yieldSpec: PositionYield, cdiAnnual: number | null): number | null {
  if (yieldSpec.type === "fixed") return yieldSpec.rate;
  if (yieldSpec.type !== "cdi") return 0;
  if (cdiAnnual === null) return null;
  const daily = (1 + cdiAnnual) ** (1 / 252) - 1;
  return (1 + daily * yieldSpec.rate) ** 252 - 1;
}

/** Renda bruta de um mês sobre o valor atual; 0 quando não dá para calcular. */
export function monthlyIncome(valueBrl: number, yieldSpec: PositionYield, cdiAnnual: number | null) {
  const annual = effectiveAnnualYield(yieldSpec, cdiAnnual);
  if (!annual || valueBrl <= 0) return 0;
  return valueBrl * ((1 + annual) ** (1 / 12) - 1);
}
