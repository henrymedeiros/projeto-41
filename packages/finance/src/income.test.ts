import { describe, expect, it } from "vitest";
import { effectiveAnnualYield, monthlyIncome } from "./index.js";

describe("effectiveAnnualYield", () => {
  const cdi = 0.1365;

  it("pays the CDI itself at 100% and compounds the daily rate above or below it", () => {
    expect(effectiveAnnualYield({ type: "cdi", rate: 1 }, cdi)).toBeCloseTo(0.1365, 10);
    const daily = (1 + cdi) ** (1 / 252) - 1;
    expect(effectiveAnnualYield({ type: "cdi", rate: 1.1 }, cdi)).toBeCloseTo((1 + daily * 1.1) ** 252 - 1, 10);
    expect(effectiveAnnualYield({ type: "cdi", rate: 0.9 }, cdi)!).toBeLessThan(cdi);
  });

  it("uses the fixed rate as is, and zero without yield", () => {
    expect(effectiveAnnualYield({ type: "fixed", rate: 0.12 }, null)).toBe(0.12);
    expect(effectiveAnnualYield({ type: "none", rate: 0 }, cdi)).toBe(0);
  });

  it("can't price a CDI position without the CDI rate", () => {
    expect(effectiveAnnualYield({ type: "cdi", rate: 1 }, null)).toBeNull();
  });
});

describe("monthlyIncome", () => {
  it("turns the annual yield into one month of gross income", () => {
    expect(monthlyIncome(10_000, { type: "fixed", rate: 0.12 }, null)).toBeCloseTo(10_000 * (1.12 ** (1 / 12) - 1), 6);
    expect(monthlyIncome(10_000, { type: "cdi", rate: 1 }, 0.1365)).toBeCloseTo(107.2, 1);
    expect(monthlyIncome(10_000, { type: "none", rate: 0 }, 0.1365)).toBe(0);
    expect(monthlyIncome(10_000, { type: "cdi", rate: 1 }, null)).toBe(0);
  });
});
