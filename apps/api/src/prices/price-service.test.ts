import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "@projeto41/db";
import { createPriceService } from "./price-service.js";

let db: AppDatabase | undefined;
afterEach(() => db?.close());

const brapiQuote = (symbol: string, price: number) =>
  new Response(JSON.stringify({ results: [{ symbol, regularMarketPrice: price }] }), { status: 200 });

describe("refreshB3Price", () => {
  it("fetches one ticker from brapi and stores the quote", async () => {
    db = createDatabase(":memory:");
    const urls: string[] = [];
    const service = createPriceService(db, {
      coingeckoApiKey: "",
      brapiToken: "token",
      fetcher: (async (input: string | URL) => {
        urls.push(String(input));
        return brapiQuote("PETR4", 38.5);
      }) as typeof fetch
    });

    expect(await service.refreshB3Price("PETR4")).toBe(true);
    expect(urls).toEqual(["https://brapi.dev/api/quote/PETR4?token=token"]);
    expect(db.prices.get("PETR4")).toMatchObject({ price: 38.5, provider: "brapi", error: null });
  });

  it("keeps the last quote and records the provider error instead of throwing", async () => {
    db = createDatabase(":memory:");
    db.prices.upsert({
      symbol: "VALE3",
      currency: "BRL",
      price: 60,
      provider: "brapi",
      marketTime: null,
      fetchedAt: "2026-10-01T12:00:00.000Z",
      error: null
    });
    const service = createPriceService(db, {
      coingeckoApiKey: "",
      brapiToken: "",
      fetcher: (async () => new Response("{}", { status: 503 })) as typeof fetch
    });

    expect(await service.refreshB3Price("VALE3")).toBe(false);
    expect(db.prices.get("VALE3")).toMatchObject({ price: 60, error: expect.stringContaining("503") });
  });
});
