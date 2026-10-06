import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "@projeto41/db";
import { buildDashboard, createDailySnapshot, snapshotDate } from "./portfolio-service.js";

let db: AppDatabase | undefined;
afterEach(() => db?.close());

describe("buildDashboard", () => {
  it("consolidates crypto, B3 and manual positions in BRL", () => {
    db = createDatabase(":memory:");
    db.operations.create({
      portfolio: "crypto",
      type: "buy",
      asset: "BTC",
      date: "2026-01-01",
      quantity: 1,
      total: 50_000,
      currency: "USD"
    });
    db.prices.upsert({
      symbol: "BTC",
      price: 60_000,
      currency: "USD",
      provider: "test",
      marketTime: null,
      fetchedAt: "2026-06-09T00:00:00Z",
      error: null
    });
    db.prices.upsert({
      symbol: "USDBRL",
      price: 5,
      currency: "BRL",
      provider: "test",
      marketTime: null,
      fetchedAt: "2026-06-09T00:00:00Z",
      error: null
    });
    db.positions.upsert({
      category: "cash",
      name: "Conta",
      invested: 1000,
      currentValue: 1000,
      currency: "BRL"
    });

    const dashboard = buildDashboard(db);
    expect(dashboard.totalBrl).toBe(301_000);
    expect(dashboard.categories.crypto).toBe(300_000);
    expect(dashboard.categories.cash).toBe(1000);
  });

  it("calculates annual return from the first snapshot of the year", () => {
    db = createDatabase(":memory:");
    db.positions.upsert({
      category: "cash",
      name: "Conta",
      invested: 110,
      currentValue: 110,
      currency: "BRL"
    });
    db.snapshots.upsert({
      date: "2026-01-01",
      totalBrl: 100,
      payload: { cash: 100 }
    });
    db.snapshots.upsert({
      date: "2026-03-01",
      totalBrl: 108,
      payload: { cash: 108 }
    });
    db.contributions.create({
      date: "2026-02-01",
      amount: 20
    });

    const dashboard = buildDashboard(db, new Date("2026-06-14T12:00:00-03:00"));

    expect(dashboard.annualReturn).toBeCloseTo(-0.1);
  });
});

describe("custom categories", () => {
  it("counts positions in a custom category and lists its label for the dashboard", () => {
    db = createDatabase(":memory:");
    db.targets.create("custom_imoveis", "Imóveis");
    db.positions.upsert({ category: "cash", name: "Conta", invested: 0, currentValue: 1000, currency: "BRL" });
    db.positions.upsert({ category: "custom_imoveis", name: "Apto", invested: 0, currentValue: 9000, currency: "BRL" });

    const dashboard = buildDashboard(db);

    expect(dashboard.totalBrl).toBe(10_000);
    expect(dashboard.categories.custom_imoveis).toBe(9000);
    expect(dashboard.customCategories).toEqual([{ key: "custom_imoveis", label: "Imóveis" }]);
  });
});

describe("monthly income", () => {
  it("adds up the gross monthly income of positions, converting USD and using the stored CDI", () => {
    db = createDatabase(":memory:");
    db.prices.upsert({ symbol: "CDI", currency: "BRL", price: 0.1365, provider: "bcb", marketTime: null, fetchedAt: "2026-10-04T00:00:00Z", error: null });
    db.prices.upsert({ symbol: "USDBRL", currency: "BRL", price: 5, provider: "bcb", marketTime: null, fetchedAt: "2026-10-04T00:00:00Z", error: null });
    const conta = db.positions.upsert({ category: "cash", name: "Conta", invested: 0, currentValue: 10_000, currency: "BRL", yieldType: "cdi", yieldRate: 1 });
    db.positions.upsert({ category: "fixed_income", name: "CDB", invested: 0, currentValue: 1000, currency: "USD", yieldType: "fixed", yieldRate: 0.12 });
    db.positions.upsert({ category: "dollar", name: "Wise", invested: 0, currentValue: 500, currency: "USD", yieldType: "none", yieldRate: 0 });

    const { monthlyIncome } = buildDashboard(db);

    const cdb = 5000 * (1.12 ** (1 / 12) - 1);
    expect(monthlyIncome.cdiAnnual).toBe(0.1365);
    expect(monthlyIncome.totalBrl).toBeCloseTo(107.198 + cdb, 2);
    expect(monthlyIncome.items.find((item) => item.id === conta)?.monthlyBrl).toBeCloseTo(107.198, 2);
    expect(monthlyIncome.items).toHaveLength(2);
    expect(monthlyIncome.cdiUnavailable).toBe(false);
  });

  it("simulates every position (even the ones without yield) earning 100% of the CDI", () => {
    db = createDatabase(":memory:");
    db.prices.upsert({ symbol: "CDI", currency: "BRL", price: 0.1365, provider: "bcb", marketTime: null, fetchedAt: "2026-10-04T00:00:00Z", error: null });
    db.prices.upsert({ symbol: "USDBRL", currency: "BRL", price: 5, provider: "bcb", marketTime: null, fetchedAt: "2026-10-04T00:00:00Z", error: null });
    db.positions.upsert({ category: "cash", name: "Conta", invested: 0, currentValue: 10_000, currency: "BRL", yieldType: "cdi", yieldRate: 1.1 });
    db.positions.upsert({ category: "fixed_income", name: "CDB", invested: 0, currentValue: 1000, currency: "USD", yieldType: "fixed", yieldRate: 0.12 });
    db.positions.upsert({ category: "dollar", name: "Wise", invested: 0, currentValue: 500, currency: "USD", yieldType: "none", yieldRate: 0 });

    // 10.000 + 5.000 + 2.500 a 100% do CDI; 10.000 a 100% do CDI rende 107,198 no mês
    expect(buildDashboard(db).monthlyIncome.potentialBrl).toBeCloseTo(107.198 * 1.75, 2);
  });

  it("has no potential income without the CDI", () => {
    db = createDatabase(":memory:");
    db.positions.upsert({ category: "cash", name: "Conta", invested: 0, currentValue: 10_000, currency: "BRL", yieldType: "none", yieldRate: 0 });

    expect(buildDashboard(db).monthlyIncome.potentialBrl).toBe(0);
  });

  it("names an income item by its institution when the position has no name", () => {
    db = createDatabase(":memory:");
    db.prices.upsert({ symbol: "CDI", currency: "BRL", price: 0.1375, provider: "bcb", marketTime: null, fetchedAt: "2026-10-04T00:00:00Z", error: null });
    db.positions.upsert({ category: "cash", name: "", institution: "Nubank", currentValue: 1000, currency: "BRL", yieldType: "cdi", yieldRate: 1 });

    expect(buildDashboard(db).monthlyIncome.items).toMatchObject([{ name: "Nubank" }]);
  });

  it("keeps using the last CDI but flags it when the latest fetch failed", () => {
    db = createDatabase(":memory:");
    db.prices.upsert({ symbol: "CDI", currency: "BRL", price: 0.1365, provider: "bcb", marketTime: "2026-09-17T03:00:00Z", fetchedAt: "2026-10-04T00:00:00Z", error: null });
    db.prices.markError("CDI", "BCB returned 503 for the Selic history", "2026-10-05T00:00:00Z");
    db.positions.upsert({ category: "cash", name: "Conta", invested: 0, currentValue: 10_000, currency: "BRL", yieldType: "cdi", yieldRate: 1 });

    const { monthlyIncome } = buildDashboard(db);

    expect(monthlyIncome).toMatchObject({ cdiAnnual: 0.1365, cdiUnavailable: true, cdiReference: "2026-09-17T03:00:00Z" });
    expect(monthlyIncome.totalBrl).toBeGreaterThan(0);
  });

  it("flags CDI positions that can't be priced without the CDI rate", () => {
    db = createDatabase(":memory:");
    db.positions.upsert({ category: "cash", name: "Conta", invested: 0, currentValue: 10_000, currency: "BRL", yieldType: "cdi", yieldRate: 1 });

    const { monthlyIncome } = buildDashboard(db);

    expect(monthlyIncome).toMatchObject({ totalBrl: 0, cdiAnnual: null, cdiUnavailable: true });
  });
});

describe("createDailySnapshot", () => {
  it("records the day and overwrites it on later runs", () => {
    db = createDatabase(":memory:");
    db.positions.upsert({ category: "cash", name: "Conta", invested: 100, currentValue: 100, currency: "BRL" });
    expect(createDailySnapshot(db, "2026-10-02")).toBe(100);

    db.positions.upsert({ category: "cash", name: "Corretora", invested: 50, currentValue: 50, currency: "BRL" });
    createDailySnapshot(db, "2026-10-02");

    expect(db.snapshots.list()).toMatchObject([{ date: "2026-10-02", totalBrl: 150, payload: { cash: 150 } }]);
  });

  it("skips an empty portfolio so a zero total never becomes the year's baseline", () => {
    db = createDatabase(":memory:");
    expect(createDailySnapshot(db, "2026-10-02")).toBeNull();
    expect(db.snapshots.list()).toEqual([]);
  });
});

describe("snapshotDate", () => {
  it("uses the calendar day of the configured timezone", () => {
    const lateNightInFortaleza = new Date("2026-10-03T01:30:00Z");
    expect(snapshotDate("America/Fortaleza", lateNightInFortaleza)).toBe("2026-10-02");
    expect(snapshotDate("UTC", lateNightInFortaleza)).toBe("2026-10-03");
  });
});
