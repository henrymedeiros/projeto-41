import type { AppDatabase, PriceRecord } from "@projeto41/db";
import { calculatePosition, monthlyIncome as positionMonthlyIncome } from "@projeto41/finance";

export function buildPortfolios(db: AppDatabase) {
  const prices = new Map(db.prices.list().map((price) => [price.symbol, price]));
  const dividends = new Map(db.dividends.list().map((item) => [item.asset, item.amount]));
  const usdBrl = prices.get("USDBRL")?.price ?? 0;

  const groups = (["crypto", "b3"] as const).map((portfolio) => {
    const operations = db.operations.list(portfolio);
    const assets = [...new Set(operations.map((operation) => operation.asset))];
    return {
      portfolio,
      assets: assets.map((asset) => {
        const price = prices.get(asset);
        const position = calculatePosition(
          operations
            .filter((operation) => operation.asset === asset)
            .map(({ type, quantity, total }) => ({ type, quantity, total })),
          price?.price ?? 0,
          portfolio === "b3" ? dividends.get(asset) ?? 0 : 0
        );
        const brlFactor = portfolio === "crypto" ? usdBrl : 1;
        return {
          asset,
          ...position,
          marketValueBrl: position.marketValue * brlFactor,
          investedBrl: position.invested * brlFactor,
          price: price?.price ?? 0,
          priceCurrency: portfolio === "crypto" ? "USD" : "BRL",
          priceStatus: priceStatus(price?.fetchedAt, price?.error),
          priceFetchedAt: price?.fetchedAt ?? null,
          dayChange: dayChange(price)
        };
      })
    };
  });

  return {
    crypto: groups.find((group) => group.portfolio === "crypto")?.assets ?? [],
    b3: groups.find((group) => group.portfolio === "b3")?.assets ?? []
  };
}

export function buildDashboard(db: AppDatabase, now = new Date()) {
  const portfolios = buildPortfolios(db);
  const prices = db.prices.list();
  const usdBrl = db.prices.get("USDBRL")?.price ?? 0;
  const categories: Record<string, number> = {
    crypto: portfolios.crypto.reduce((sum, asset) => sum + asset.marketValueBrl, 0),
    b3: portfolios.b3.reduce((sum, asset) => sum + asset.marketValueBrl, 0),
    dollar: 0,
    cash: 0,
    reserve: 0,
    fixed_income: 0,
    global: 0
  };

  const positions = db.positions.list();
  for (const position of positions) {
    categories[position.category] =
      (categories[position.category] ?? 0) +
      position.currentValue * (position.currency === "USD" ? usdBrl : 1);
  }

  const totalBrl = Object.values(categories).reduce((sum, value) => sum + value, 0);
  const contributions = db.contributions.list();
  const currentYear = now.getFullYear();
  const annualContributions = contributions
    .filter((item) => Number(item.date.slice(0, 4)) === currentYear)
    .reduce((sum, item) => sum + item.amount, 0);
  const history = db.snapshots.list();
  const firstSnapshotOfYear = history.find((snapshot) =>
    snapshot.date.startsWith(String(currentYear))
  );
  const annualReturn =
    firstSnapshotOfYear && firstSnapshotOfYear.totalBrl > 0
      ? (totalBrl - annualContributions) / firstSnapshotOfYear.totalBrl - 1
      : 0;

  return {
    totalBrl,
    totalUsd: usdBrl > 0 ? totalBrl / usdBrl : 0,
    usdBrl,
    categories,
    annualContributions,
    annualReturn,
    history,
    prices,
    portfolios,
    reserveBrl: categories.reserve ?? 0,
    monthlyIncome: buildMonthlyIncome(positions, db.prices.get("CDI"), usdBrl),
    customCategories: db.targets
      .list()
      .filter((target) => target.label && target.category.startsWith("custom_"))
      .map((target) => ({ key: target.category, label: target.label as string })),
    // "Cotações há X min" fala de preços de ativos; o CDI (taxa) não conta
    updatedAt: prices
      .filter((price) => price.symbol !== "CDI")
      .reduce((latest, price) => (price.fetchedAt > latest ? price.fetchedAt : latest), "")
  };
}

/**
 * Renda mensal bruta das posições, pelo rendimento de cada uma sobre o valor atual.
 * Pensada para receber outras fontes depois (ex.: dividendos de ativos) como novos itens.
 */
function buildMonthlyIncome(
  positions: ReturnType<AppDatabase["positions"]["list"]>,
  cdi: PriceRecord | undefined,
  usdBrl: number
) {
  // Sem CDI ou com a última busca falhando, o front avisa explicitamente; enquanto houver
  // um valor anterior, ele continua sendo usado (e a data dele vai junto).
  const cdiAnnual = cdi && cdi.price > 0 ? cdi.price : null;
  const items = positions
    .filter((position) => position.yieldType !== "none" && position.currentValue > 0)
    .map((position) => ({
      id: position.id,
      name: position.name || position.institution || "",
      category: position.category,
      monthlyBrl: positionMonthlyIncome(
        position.currentValue * (position.currency === "USD" ? usdBrl : 1),
        { type: position.yieldType, rate: position.yieldRate },
        cdiAnnual
      )
    }));
  return {
    totalBrl: items.reduce((sum, item) => sum + item.monthlyBrl, 0),
    cdiAnnual,
    cdiUnavailable: cdiAnnual === null || Boolean(cdi?.error),
    cdiReference: cdi?.marketTime ?? null,
    items
  };
}

/** Dia (AAAA-MM-DD) de `now` no fuso usado pelos snapshots. */
export function snapshotDate(timezone: string, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

// Grava (ou sobrescreve) o registro do dia: a última gravação do dia vira o fechamento.
// Carteira vazia não grava, senão um total zerado viraria a base da rentabilidade do ano.
export function createDailySnapshot(db: AppDatabase, date: string) {
  const dashboard = buildDashboard(db);
  if (dashboard.totalBrl <= 0) return null;
  const priceTimes = Object.fromEntries(
    dashboard.prices.map((price) => [price.symbol, price.fetchedAt])
  );
  db.snapshots.upsert({
    date,
    totalBrl: dashboard.totalBrl,
    payload: dashboard.categories,
    priceTimes
  });
  return dashboard.totalBrl;
}

// Variação do dia por ativo, como razão (0.012 = +1,2%) ou null quando indisponível.
// Calculada sempre aqui: preço atual vs. o "fechamento" do dia anterior gravado no
// baseline (prevPrice/prevDay). Não usamos percentual de provedor externo.
function dayChange(price?: PriceRecord): number | null {
  if (!price || price.error) return null;
  const today = price.fetchedAt.slice(0, 10);
  if (price.prevPrice && price.prevPrice > 0 && price.prevDay && price.prevDay < today) {
    return price.price / price.prevPrice - 1;
  }
  return null;
}

function priceStatus(fetchedAt?: string, error?: string | null) {
  if (!fetchedAt) return "unavailable";
  if (error) return "stale";
  const age = Date.now() - new Date(fetchedAt).getTime();
  return age > 60 * 60 * 1000 ? "stale" : "current";
}
