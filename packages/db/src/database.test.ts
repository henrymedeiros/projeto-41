import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "./index.js";

let db: AppDatabase | undefined;
let temporaryDirectory: string | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
  if (temporaryDirectory) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

describe("database", () => {
  it("creates generic allocation targets for a new database", () => {
    db = createDatabase(":memory:");

    const targets = db.targets.list();

    expect(targets.map((target) => target.category)).toEqual([
      "acoes_globais",
      "bitcoin",
      "bolsa_brasil",
      "caixa_br",
      "dolar",
      "renda_fixa",
      "shitcoins"
    ]);
    expect(targets.reduce((sum, target) => sum + target.weight, 0)).toBeCloseTo(1);
  });

  it("does not add defaults to an existing custom allocation", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "projeto41-db-"));
    const databasePath = join(temporaryDirectory, "portfolio.sqlite");
    db = createDatabase(databasePath);
    db.raw.exec("DELETE FROM allocation_targets");
    db.targets.set("custom", 1);
    db.close();

    db = createDatabase(databasePath);

    expect(db.targets.list()).toEqual([{ category: "custom", weight: 1, label: null }]);
  });

  it("keeps custom allocation categories with their label and counts positions in them", () => {
    db = createDatabase(":memory:");
    db.targets.create("custom_imoveis", "Imóveis");
    db.targets.set("custom_imoveis", 0.2);
    db.positions.upsert({ category: "custom_imoveis", name: "Apto", invested: 0, currentValue: 300_000, currency: "BRL" });

    expect(db.targets.list().find((target) => target.category === "custom_imoveis")).toEqual({
      category: "custom_imoveis",
      weight: 0.2,
      label: "Imóveis"
    });
    expect(db.positions.countByCategory("custom_imoveis")).toBe(1);
    expect(db.positions.countByCategory("cash")).toBe(0);

    db.targets.remove("custom_imoveis");
    expect(db.targets.list().some((target) => target.category === "custom_imoveis")).toBe(false);
  });

  it("remembers the CoinGecko slug for a crypto symbol", () => {
    db = createDatabase(":memory:");
    db.cryptoAssets.upsert({ symbol: "AVAX", slug: "avalanche-2", name: "Avalanche" });

    expect(db.cryptoAssets.get("AVAX")).toEqual({
      symbol: "AVAX",
      slug: "avalanche-2",
      name: "Avalanche"
    });

    db.cryptoAssets.upsert({ symbol: "AVAX", slug: "avalanche", name: "Avalanche Renamed" });
    expect(db.cryptoAssets.get("AVAX")?.slug).toBe("avalanche");
  });

  it("stores where a position is held", () => {
    db = createDatabase(":memory:");
    db.positions.upsert({ category: "cash", name: "Conta", currentValue: 10, currency: "BRL", institution: "Nubank" });
    db.positions.upsert({ category: "dollar", name: "Reserva USD", currentValue: 5, currency: "USD" });

    expect(db.positions.list().map((position) => [position.name, position.institution])).toEqual([
      ["Conta", "Nubank"],
      ["Reserva USD", null]
    ]);
  });

  it("stores the yield of a position", () => {
    db = createDatabase(":memory:");
    const id = db.positions.upsert({
      category: "fixed_income",
      name: "CDB",
      invested: 1000,
      currentValue: 1100,
      currency: "BRL",
      yieldType: "fixed",
      yieldRate: 0.12
    });

    expect(db.positions.list()).toMatchObject([{ id, yieldType: "fixed", yieldRate: 0.12 }]);
  });

  it("gives existing Real and reserve positions 100% of the CDI when the yield columns arrive", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "projeto41-db-"));
    const databasePath = join(temporaryDirectory, "portfolio.sqlite");
    db = createDatabase(databasePath);
    db.raw.exec("ALTER TABLE manual_positions DROP COLUMN yield_type; ALTER TABLE manual_positions DROP COLUMN yield_rate;");
    db.raw.exec(`INSERT INTO manual_positions (category, name, invested, current_value, currency) VALUES
      ('cash', 'Conta', 0, 100, 'BRL'), ('reserve', 'Caixinha', 0, 200, 'BRL'), ('dollar', 'Wise', 0, 50, 'USD')`);
    db.close();

    db = createDatabase(databasePath);

    expect(db.positions.list().map((position) => [position.name, position.yieldType, position.yieldRate])).toEqual([
      ["Conta", "cdi", 1],
      ["Wise", "none", 0],
      ["Caixinha", "cdi", 1]
    ]);
  });

  it("stores operations and enforces one snapshot per date", () => {
    db = createDatabase(":memory:");
    db.operations.create({
      portfolio: "crypto",
      type: "buy",
      asset: "BTC",
      date: "2026-06-09",
      quantity: 0.01,
      total: 650,
      currency: "USD"
    });

    expect(db.operations.list()).toHaveLength(1);

    db.snapshots.upsert({
      date: "2026-06-09",
      totalBrl: 100,
      payload: { BTC: 100 }
    });
    db.snapshots.upsert({
      date: "2026-06-09",
      totalBrl: 110,
      payload: { BTC: 110 }
    });

    expect(db.snapshots.list()).toHaveLength(1);
    expect(db.snapshots.list()[0]?.totalBrl).toBe(110);
  });

  it("rolls the daily price baseline only when a new day arrives", () => {
    db = createDatabase(":memory:");
    const base = {
      symbol: "BTC",
      currency: "USD" as const,
      provider: "test",
      marketTime: null,
      error: null
    };

    // Primeiro dia: o baseline é o próprio preço (sem referência anterior).
    db.prices.upsert({ ...base, price: 100, fetchedAt: "2026-06-09T10:00:00Z" });
    let row = db.prices.get("BTC");
    expect(row?.prevPrice).toBe(100);
    expect(row?.prevDay).toBe("2026-06-09");

    // Mais cotações no mesmo dia não mudam o baseline.
    db.prices.upsert({ ...base, price: 120, fetchedAt: "2026-06-09T18:00:00Z" });
    row = db.prices.get("BTC");
    expect(row?.prevPrice).toBe(100);
    expect(row?.prevDay).toBe("2026-06-09");

    // Novo dia: o último preço do dia anterior (120) vira a referência.
    db.prices.upsert({ ...base, price: 132, fetchedAt: "2026-06-10T09:00:00Z" });
    row = db.prices.get("BTC");
    expect(row?.prevPrice).toBe(120);
    expect(row?.prevDay).toBe("2026-06-09");

    // Outra cotação ainda no dia 10 mantém a referência do dia 9.
    db.prices.upsert({ ...base, price: 140, fetchedAt: "2026-06-10T15:00:00Z" });
    row = db.prices.get("BTC");
    expect(row?.prevPrice).toBe(120);
    expect(row?.prevDay).toBe("2026-06-09");
  });
});
