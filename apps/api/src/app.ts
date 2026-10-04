import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import Fastify from "fastify";
import {
  contributionSchema,
  customCategoryKey,
  isCustomCategory,
  manualPositionSchema,
  operationSchema
} from "@projeto41/contracts";
import type { AppDatabase } from "@projeto41/db";
import { z } from "zod";
import type { IconService } from "./icons/icon-service.js";
import { buildOperationsCsv, parseOperationsCsv } from "./export/operations-csv.js";
import { buildDashboard, buildPortfolios } from "./services/portfolio-service.js";

type CryptoSearchHit = { id: string; symbol: string; name: string; rank: number | null };
type B3SearchHit = { symbol: string; name: string; price: number; currency: string };

type PriceService = {
  runAll(): Promise<unknown>;
  runCrypto?(): Promise<unknown>;
  ensureCryptoPrice?(symbol: string): Promise<boolean>;
  quoteCrypto?(symbol: string, slug?: string): Promise<number | null>;
  searchCrypto?(query: string): Promise<CryptoSearchHit[]>;
  searchB3?(query: string): Promise<B3SearchHit[]>;
};

export function buildApp({
  db,
  priceService,
  iconService,
  webRoot
}: {
  db: AppDatabase;
  priceService: PriceService;
  iconService?: IconService;
  webRoot?: string;
}) {
  const app = Fastify({ logger: false });
  app.register(cors, { origin: /^http:\/\/127\.0\.0\.1(?::\d+)?$/ });
  app.addContentTypeParser("text/csv", { parseAs: "string" }, (_request, body, done) => {
    done(null, body);
  });
  if (webRoot) {
    app.register(staticPlugin, {
      root: webRoot,
      index: ["index.html"]
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.status(400).send({ error: "Dados invalidos", details: error.flatten() });
    }
    if (
      error instanceof Error &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      return reply.status(error.statusCode).send({ error: error.message });
    }
    app.log.error(error);
    return reply.status(500).send({ error: "Erro interno" });
  });

  app.get("/api/health", async () => ({ ok: true }));

  if (iconService) {
    app.get("/api/icons/:kind/:key", async (request, reply) => {
      const { kind, key } = z
        .object({
          kind: z.enum(["crypto", "b3", "institution"]),
          key: z.string().min(1).max(80)
        })
        .parse(request.params);
      const icon = await iconService.read(kind, key);
      if (!icon) return reply.status(404).send({ error: "Icone indisponivel" });
      reply.header("Cache-Control", "public, max-age=604800");
      return reply.type(icon.contentType).send(icon.data);
    });
  }
  app.get("/api/dashboard", async () => buildDashboard(db));
  app.get("/api/portfolios", async () => buildPortfolios(db));

  const cryptoAssetSchema = z.object({
    slug: z.string().trim().optional(),
    name: z.string().trim().optional()
  });

  function rememberCryptoAsset(
    operation: { portfolio: "crypto" | "b3"; asset: string },
    body: unknown
  ) {
    if (operation.portfolio !== "crypto") return;
    const { slug, name } = cryptoAssetSchema.parse(body);
    if (!slug) return;
    db.cryptoAssets.upsert({ symbol: operation.asset, slug, name: name || operation.asset });
  }

  app.get("/api/operations", async (request) => {
    const query = z.object({ portfolio: z.enum(["crypto", "b3"]).optional() }).parse(request.query);
    return db.operations.list(query.portfolio);
  });
  app.get("/api/crypto/search", async (request) => {
    const { q } = z.object({ q: z.string().trim().min(1).max(80) }).parse(request.query);
    if (!priceService.searchCrypto) return [];
    return priceService.searchCrypto(q);
  });
  // Cotação de hoje para preencher o preço no formulário de operação (não grava nada).
  app.get("/api/crypto/quote", async (request, reply) => {
    const { symbol, slug } = z
      .object({ symbol: z.string().trim().min(1).max(30), slug: z.string().trim().min(1).max(120).optional() })
      .parse(request.query);
    const upper = symbol.toUpperCase();
    const price = priceService.quoteCrypto ? await priceService.quoteCrypto(upper, slug) : null;
    if (!price) return reply.status(404).send({ error: `Cotação de ${upper} indisponível` });
    return { symbol: upper, price, currency: "USD" };
  });
  app.get("/api/b3/search", async (request) => {
    const { q } = z.object({ q: z.string().trim().min(1).max(80) }).parse(request.query);
    if (!priceService.searchB3) return [];
    return priceService.searchB3(q);
  });
  // Depois de salvar uma operação de cripto, atualiza as cotações de cripto (uma chamada
  // à CoinGecko para todos os ativos), para a carteira já aparecer com o preço de agora.
  // Falha do provedor não impede o salvamento: o runCrypto registra o erro na cotação.
  async function refreshCryptoPrices(operation: { portfolio: string; asset: string }) {
    if (operation.portfolio !== "crypto") return;
    if (priceService.runCrypto) await priceService.runCrypto();
    else if (priceService.ensureCryptoPrice) await priceService.ensureCryptoPrice(operation.asset);
  }

  app.post("/api/operations", async (request, reply) => {
    const operation = operationSchema.parse(request.body);
    rememberCryptoAsset(operation, request.body);
    const id = db.operations.create(operation);
    await refreshCryptoPrices(operation);
    return reply.status(201).send({ id, portfolios: buildPortfolios(db) });
  });
  app.put("/api/operations/:id", async (request) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const operation = operationSchema.parse(request.body);
    rememberCryptoAsset(operation, request.body);
    db.operations.update(id, operation);
    await refreshCryptoPrices(operation);
    return { ok: true, portfolios: buildPortfolios(db) };
  });
  app.delete("/api/operations/:id", async (request) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    db.operations.remove(id);
    return { ok: true, portfolios: buildPortfolios(db) };
  });
  app.delete("/api/operations", async (request) => {
    const { portfolio } = z
      .object({ portfolio: z.enum(["crypto", "b3"]).optional() })
      .parse(request.query);
    const removed = db.operations.clear(portfolio);
    return { ok: true, removed, portfolios: buildPortfolios(db) };
  });

  // Posição numa categoria customizada só se a categoria existir na Alocação.
  function unknownCategory(category: string) {
    return isCustomCategory(category) && !db.targets.list().some((target) => target.category === category);
  }

  app.get("/api/positions", async () => db.positions.list());
  app.post("/api/positions", async (request, reply) => {
    const position = manualPositionSchema.parse(request.body);
    if (unknownCategory(position.category)) return reply.status(400).send({ error: "Categoria inexistente" });
    const id = db.positions.upsert(position);
    return reply.status(201).send({ id });
  });
  app.put("/api/positions/:id", async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const position = manualPositionSchema.parse(request.body);
    if (unknownCategory(position.category)) return reply.status(400).send({ error: "Categoria inexistente" });
    db.positions.upsert({ ...position, id });
    return { ok: true };
  });
  app.delete("/api/positions/:id", async (request) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    db.positions.remove(id);
    return { ok: true };
  });

  app.get("/api/dividends", async () => db.dividends.list());
  app.put("/api/dividends/:asset", async (request) => {
    const { asset } = z.object({ asset: z.string().min(1) }).parse(request.params);
    const { amount } = z.object({ amount: z.number().nonnegative() }).parse(request.body);
    db.dividends.set(asset.toUpperCase(), amount);
    return { ok: true };
  });

  app.get("/api/contributions", async () => db.contributions.list());
  app.post("/api/contributions", async (request, reply) => {
    const id = db.contributions.create(contributionSchema.parse(request.body));
    return reply.status(201).send({ id });
  });
  app.put("/api/contributions/:id", async (request) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    db.contributions.update(id, contributionSchema.parse(request.body));
    return { ok: true };
  });
  app.delete("/api/contributions/:id", async (request) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    db.contributions.remove(id);
    return { ok: true };
  });

  app.get("/api/allocation", async () =>
    db.targets.list().map((target) => ({ ...target, custom: isCustomCategory(target.category) }))
  );
  app.post("/api/allocation/categories", async (request, reply) => {
    const { label } = z.object({ label: z.string().trim().min(1).max(40) }).parse(request.body);
    const category = customCategoryKey(label);
    if (!category) return reply.status(400).send({ error: "Use letras ou números no nome da categoria" });
    if (db.targets.list().some((target) => target.category === category)) {
      return reply.status(409).send({ error: `Já existe uma categoria "${label}"` });
    }
    db.targets.create(category, label);
    return reply.status(201).send({ category, weight: 0, label, custom: true });
  });
  // Só categorias customizadas, e sem posições: apagar com posições tiraria dinheiro do patrimônio.
  app.delete("/api/allocation/:category", async (request, reply) => {
    const { category } = z.object({ category: z.string().min(1) }).parse(request.params);
    if (!isCustomCategory(category)) {
      return reply.status(400).send({ error: "Categorias padrão não podem ser removidas" });
    }
    const positions = db.positions.countByCategory(category);
    if (positions > 0) {
      return reply.status(409).send({
        error: `Há ${positions} ${positions === 1 ? "posição" : "posições"} nesta categoria; mova ou exclua antes`
      });
    }
    db.targets.remove(category);
    return { ok: true };
  });
  app.put("/api/allocation/:category", async (request) => {
    const { category } = z.object({ category: z.string().min(1) }).parse(request.params);
    const { weight } = z.object({ weight: z.number().min(0).max(1) }).parse(request.body);
    db.targets.set(category, weight);
    return { ok: true };
  });

  app.get("/api/planning", async () => ({
    initialCapital: Number(db.settings.get("initialCapital") ?? 0),
    monthlyContribution: Number(db.settings.get("monthlyContribution") ?? 0),
    monthlyReturnPercent: Number(db.settings.get("monthlyReturnPercent") ?? 0),
    months: Number(db.settings.get("months") ?? 120),
    annualInflationPercent: Number(db.settings.get("annualInflationPercent") ?? 0),
    initialYear: Number(db.settings.get("initialYear") ?? new Date().getFullYear())
  }));
  app.put("/api/planning", async (request) => {
    const values = z
      .object({
        initialCapital: z.number().nonnegative(),
        monthlyContribution: z.number().nonnegative(),
        monthlyReturnPercent: z.number(),
        months: z.number().int().positive(),
        annualInflationPercent: z.number(),
        initialYear: z.number().int()
      })
      .parse(request.body);
    for (const [key, value] of Object.entries(values)) db.settings.set(key, String(value));
    return { ok: true };
  });

  app.get("/api/history", async () => db.snapshots.list());
  app.get("/api/prices", async () => db.prices.list());
  app.post("/api/prices/refresh", async () => {
    try {
      return { results: await priceService.runAll(), errors: [] };
    } catch (error) {
      return {
        results: [],
        errors: [error instanceof Error ? error.message : "Falha ao atualizar precos"]
      };
    }
  });
  app.get("/api/export/operations.csv", async (_request, reply) => {
    const operations = db.operations.list("crypto");
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="operacoes-cripto.csv"`);
    return buildOperationsCsv(operations);
  });
  app.post("/api/import/operations.csv", async (request, reply) => {
    const text = typeof request.body === "string" ? request.body : "";
    const operations = parseOperationsCsv(text).map((row) => operationSchema.parse(row));
    if (operations.length === 0) {
      return reply.status(400).send({ error: "Nenhuma operação encontrada no CSV" });
    }
    for (const operation of operations) db.operations.create(operation);
    if (priceService.ensureCryptoPrice) {
      const assets = [...new Set(operations.map((operation) => operation.asset))];
      for (const asset of assets) await priceService.ensureCryptoPrice(asset);
    }
    return reply
      .status(201)
      .send({ imported: operations.length, portfolios: buildPortfolios(db) });
  });
  app.get("/api/export", async (_request, reply) => {
    reply.header("Content-Disposition", `attachment; filename="projeto41-export.json"`);
    return {
      exportedAt: new Date().toISOString(),
      operations: db.operations.list(),
      positions: db.positions.list(),
      dividends: db.dividends.list(),
      contributions: db.contributions.list(),
      targets: db.targets.list(),
      prices: db.prices.list(),
      snapshots: db.snapshots.list()
    };
  });

  return app;
}
