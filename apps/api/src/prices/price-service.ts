import type { AppDatabase } from "@projeto41/db";
import {
  fetchB3Price,
  fetchCryptoPrices,
  fetchUsdBrl,
  searchB3Assets,
  searchCryptoAssets
} from "./providers.js";

const cryptoSlugs: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  ADA: "cardano",
  AVAX: "avalanche-2",
  SOL: "solana",
  AXL: "axelar",
  LINK: "chainlink",
  FET: "fetch-ai",
  UMA: "uma",
  ATOM: "cosmos",
  PENDLE: "pendle",
  VET: "vechain",
  MKR: "maker",
  LDO: "lido-dao",
  SEI: "sei-network",
  DYDX: "dydx-chain",
  NEAR: "near",
  ASTR: "astar",
  SNX: "havven",
  POL: "polygon-ecosystem-token",
  VANRY: "vanar-chain",
  DOT: "polkadot",
  IMX: "immutable-x",
  RENDER: "render-token",
  AAVE: "aave"
};

export function createPriceService(
  db: AppDatabase,
  options: {
    coingeckoApiKey: string;
    brapiToken: string;
    fetcher?: typeof fetch;
  }
) {
  const fetcher = options.fetcher ?? fetch;

  function slugFor(symbol: string) {
    return db.cryptoAssets.get(symbol)?.slug ?? cryptoSlugs[symbol] ?? symbol.toLowerCase();
  }

  async function runCrypto() {
    const symbols = [
      ...new Set(db.operations.list("crypto").map((operation) => operation.asset))
    ];
    if (symbols.length === 0) {
      return { provider: "crypto", updated: 0, errors: [] as string[] };
    }
    try {
      const { records, errors } = await fetchCryptoPrices(
        symbols.map((symbol) => ({ symbol, slug: slugFor(symbol) })),
        options.coingeckoApiKey,
        fetcher
      );
      const erroredAt = new Date().toISOString();
      for (const quote of records) db.prices.upsert(quote);
      for (const { symbol, message } of errors) db.prices.markError(symbol, message, erroredAt);
      return { provider: "crypto", updated: records.length, errors: errors.map((e) => e.message) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown crypto provider error";
      for (const symbol of symbols) db.prices.markError(symbol, message, new Date().toISOString());
      return { provider: "crypto", updated: 0, errors: [message] };
    }
  }

  async function ensureCryptoPrice(symbol: string) {
    const existing = db.prices.get(symbol);
    if (existing && existing.price > 0) return false;
    try {
      const { records, errors } = await fetchCryptoPrices(
        [{ symbol, slug: slugFor(symbol) }],
        options.coingeckoApiKey,
        fetcher
      );
      const [quote] = records;
      if (quote) {
        db.prices.upsert(quote);
        return true;
      }
      const erroredAt = new Date().toISOString();
      for (const { message } of errors) db.prices.markError(symbol, message, erroredAt);
      return false;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown crypto provider error";
      db.prices.markError(symbol, message, new Date().toISOString());
      return false;
    }
  }

  // Preço de hoje em USD sem gravar: o formulário pede antes de a operação existir.
  async function quoteCrypto(symbol: string, slug?: string) {
    try {
      const { records } = await fetchCryptoPrices(
        [{ symbol, slug: slug ?? slugFor(symbol) }],
        options.coingeckoApiKey,
        fetcher
      );
      return records[0]?.price ?? null;
    } catch {
      return null;
    }
  }

  // Atualiza a cotação de um ticker (uma chamada à brapi); devolve a mensagem de erro, se houver.
  async function updateB3Price(symbol: string) {
    try {
      db.prices.upsert(await fetchB3Price(symbol, options.brapiToken, fetcher));
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : `Unknown brapi error for ${symbol}`;
      db.prices.markError(symbol, message, new Date().toISOString());
      return message;
    }
  }

  async function runB3() {
    const symbols = [...new Set(db.operations.list("b3").map((operation) => operation.asset))];
    const errors: string[] = [];
    let updated = 0;
    for (const symbol of symbols) {
      const error = await updateB3Price(symbol);
      if (error) errors.push(error);
      else updated += 1;
    }
    return { provider: "b3", updated, errors };
  }

  // Ao salvar uma operação da B3: só o ticker dela (a brapi cobra uma chamada por ticker).
  async function refreshB3Price(symbol: string) {
    return (await updateB3Price(symbol)) === null;
  }

  async function runCurrency() {
    try {
      db.prices.upsert(await fetchUsdBrl(new Date(), fetcher));
      return { provider: "currency", updated: 1, errors: [] as string[] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown BCB error";
      db.prices.markError("USDBRL", message, new Date().toISOString());
      return { provider: "currency", updated: 0, errors: [message] };
    }
  }

  async function searchCrypto(query: string) {
    return searchCryptoAssets(query, options.coingeckoApiKey, fetcher);
  }

  async function searchB3(query: string) {
    return searchB3Assets(query, options.brapiToken, fetcher);
  }

  return {
    runCrypto,
    runB3,
    refreshB3Price,
    runCurrency,
    ensureCryptoPrice,
    quoteCrypto,
    searchCrypto,
    searchB3,
    runAll: () => Promise.all([runCrypto(), runB3(), runCurrency()])
  };
}

