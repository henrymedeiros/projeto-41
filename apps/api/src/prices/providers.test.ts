import { describe, expect, it } from "vitest";
import {
  fetchB3Price,
  fetchCdi,
  fetchCryptoPrices,
  fetchUsdBrl,
  searchB3Assets,
  searchCryptoAssets
} from "./providers.js";

describe("price providers", () => {
  it("parses the CoinGecko simple/price response", async () => {
    const fetcher = async () => Response.json({ bitcoin: { usd: 65000.5 }, ethereum: { usd: 3200 } });
    const { records, errors } = await fetchCryptoPrices(
      [
        { slug: "bitcoin", symbol: "BTC" },
        { slug: "ethereum", symbol: "ETH" }
      ],
      "demo-key",
      fetcher as typeof fetch
    );
    expect(records[0]).toMatchObject({ symbol: "BTC", price: 65000.5, currency: "USD", provider: "coingecko" });
    expect(records[1]).toMatchObject({ symbol: "ETH", price: 3200 });
    expect(errors).toEqual([]);
  });

  it("isolates a coin with a missing price instead of failing the batch", async () => {
    const fetcher = async () => Response.json({ bitcoin: { usd: 65000.5 } });
    const { records, errors } = await fetchCryptoPrices(
      [
        { slug: "bitcoin", symbol: "BTC" },
        { slug: "delisted-coin", symbol: "DEAD" }
      ],
      "demo-key",
      fetcher as typeof fetch
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ symbol: "BTC", price: 65000.5 });
    expect(errors).toEqual([{ symbol: "DEAD", message: "Invalid crypto price for DEAD" }]);
  });

  it("parses one B3 quote from brapi", async () => {
    const fetcher = async () =>
      Response.json({
        results: [{ symbol: "PETR4", regularMarketPrice: 42.5, regularMarketTime: "2026-06-09T17:00:00Z" }]
      });
    const price = await fetchB3Price("PETR4", "token", fetcher as typeof fetch);
    expect(price).toMatchObject({ symbol: "PETR4", price: 42.5, currency: "BRL" });
  });

  it("retries a B3 quote after a transient request failure", async () => {
    let attempts = 0;
    const fetcher = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("The operation was aborted due to timeout");
      return Response.json({
        results: [{ symbol: "BBAS3", regularMarketPrice: 25.4 }]
      });
    };

    const price = await fetchB3Price("BBAS3", "token", fetcher as typeof fetch);

    expect(attempts).toBe(2);
    expect(price).toMatchObject({ symbol: "BBAS3", price: 25.4 });
  });

  it("maps the brapi quote/list response to B3 ticker matches with price", async () => {
    const fetcher = async (input: string | URL) => {
      expect(String(input)).toContain("search=petr");
      return Response.json({
        stocks: [
          { stock: "PETR4", name: "PETROLEO BRASILEIRO S.A. PETROBRAS", close: 37.8 },
          { stock: "PETR3", name: "PETROLEO BRASILEIRO S.A. PETROBRAS", close: 41.78 },
          { stock: "", name: "sem ticker" }
        ]
      });
    };
    const results = await searchB3Assets("petr", "token", fetcher as typeof fetch);
    expect(results).toEqual([
      { symbol: "PETR4", name: "PETROLEO BRASILEIRO S.A. PETROBRAS", price: 37.8, currency: "BRL" },
      { symbol: "PETR3", name: "PETROLEO BRASILEIRO S.A. PETROBRAS", price: 41.78, currency: "BRL" }
    ]);
  });

  it("returns no B3 matches for an empty query without calling the API", async () => {
    let called = false;
    const fetcher = async () => {
      called = true;
      return Response.json({});
    };
    const results = await searchB3Assets("   ", "token", fetcher as typeof fetch);
    expect(results).toEqual([]);
    expect(called).toBe(false);
  });

  it("maps the CoinGecko search response to symbol/id matches", async () => {
    const fetcher = async (input: string | URL) => {
      expect(String(input)).toContain("query=btc");
      return Response.json({
        coins: [
          { id: "bitcoin", symbol: "btc", name: "Bitcoin", market_cap_rank: 1 },
          { id: "wrapped-bitcoin", symbol: "wbtc", name: "Wrapped Bitcoin", market_cap_rank: 15 },
          { id: "", symbol: "", name: "" }
        ]
      });
    };
    const results = await searchCryptoAssets("btc", "demo-key", fetcher as typeof fetch);
    expect(results).toEqual([
      { id: "bitcoin", symbol: "BTC", name: "Bitcoin", rank: 1 },
      { id: "wrapped-bitcoin", symbol: "WBTC", name: "Wrapped Bitcoin", rank: 15 }
    ]);
  });

  it("returns no search matches for an empty query without calling the API", async () => {
    let called = false;
    const fetcher = async () => {
      called = true;
      return Response.json({});
    };
    const results = await searchCryptoAssets("   ", "demo-key", fetcher as typeof fetch);
    expect(results).toEqual([]);
    expect(called).toBe(false);
  });

  it("parses the official BCB PTAX response", async () => {
    const fetcher = async () =>
      Response.json({ value: [{ cotacaoVenda: 5.21, dataHoraCotacao: "2026-06-09 13:00:00.000" }] });
    const price = await fetchUsdBrl(new Date("2026-06-09T12:00:00Z"), fetcher as typeof fetch);
    expect(price).toMatchObject({ symbol: "USDBRL", price: 5.21, provider: "bcb" });
  });

  it("uses the current Selic target from the BCB interest-rate history as is", async () => {
    const urls: string[] = [];
    const fetcher = async (input: string | URL) => {
      urls.push(String(input));
      return Response.json({
        conteudo: [
          { MetaSelic: 13.75, DataInicioVigencia: "2026-09-17T03:00:00Z", DataFimVigencia: null },
          { MetaSelic: 14.0, DataInicioVigencia: "2026-08-06T03:00:00Z", DataFimVigencia: "2026-09-16T03:00:00Z" }
        ]
      });
    };

    const rate = await fetchCdi(fetcher as typeof fetch);

    expect(urls).toEqual(["https://www.bcb.gov.br/api/servico/sitebcb/historicotaxasjuros"]);
    expect(rate).toMatchObject({ symbol: "CDI", currency: "BRL", provider: "bcb", marketTime: "2026-09-17T03:00:00Z" });
    expect(rate.price).toBeCloseTo(0.1375, 10);
  });

  it("fails loudly when the BCB stops returning a current Selic target", async () => {
    const empty = async () => Response.json({ conteudo: [] });
    const onlyPast = async () =>
      Response.json({ conteudo: [{ MetaSelic: 14, DataInicioVigencia: "2026-08-06T03:00:00Z", DataFimVigencia: "2026-09-16T03:00:00Z" }] });
    const down = async () => new Response("<html>erro</html>", { status: 503 });
    const html = async () => new Response("<html>mudou</html>", { status: 200 });

    await expect(fetchCdi(empty as typeof fetch)).rejects.toThrow("CDI");
    await expect(fetchCdi(onlyPast as typeof fetch)).rejects.toThrow("CDI");
    await expect(fetchCdi(down as typeof fetch)).rejects.toThrow("503");
    await expect(fetchCdi(html as typeof fetch)).rejects.toThrow();
  });
});
