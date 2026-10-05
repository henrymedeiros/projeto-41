import { z } from "zod";

export const portfolioSchema = z.enum(["crypto", "b3"]);
export const operationTypeSchema = z.enum(["buy", "sell"]);
export const currencySchema = z.enum(["BRL", "USD"]);

export const operationSchema = z.object({
  id: z.number().int().positive().optional(),
  portfolio: portfolioSchema,
  type: operationTypeSchema,
  asset: z.string().trim().min(1).transform((value) => value.toUpperCase()),
  date: z.string().date(),
  quantity: z.number().positive(),
  total: z.number().nonnegative(),
  currency: currencySchema,
  notes: z.string().trim().optional()
});

// Categorias customizadas (criadas na Alocação) usam a chave custom_<nome sem acento>.
export const customCategoryPattern = /^custom_[a-z0-9]+(?:_[a-z0-9]+)*$/;

export function isCustomCategory(category: string) {
  return customCategoryPattern.test(category);
}

/** Chave de uma categoria customizada a partir do nome digitado; null se não sobrar letra ou número. */
export function customCategoryKey(label: string) {
  const slug = label
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .slice(0, 40)
    .replace(/^_+|_+$/g, "");
  return slug ? `custom_${slug}` : null;
}

export const manualPositionSchema = z.object({
  id: z.number().int().positive().optional(),
  category: z.union([
    z.enum(["dollar", "cash", "reserve", "fixed_income", "global"]),
    z.string().regex(customCategoryPattern)
  ]),
  // nome e instituição: basta um dos dois (veja o refine abaixo)
  name: z.string().trim().default(""),
  // onde a posição está: banco, corretora, carteira digital…
  institution: z.string().trim().max(60).optional(),
  invested: z.number().nonnegative().default(0),
  currentValue: z.number().nonnegative(),
  currency: currencySchema.default("BRL"),
  notes: z.string().trim().optional(),
  // rendimento: cdi = % do CDI (1 = 100%), fixed = prefixado ao ano (0.12 = 12%), none = não rende
  yieldType: z.enum(["cdi", "fixed", "none"]).default("none"),
  yieldRate: z.number().min(0).max(10).default(0)
}).refine((position) => position.name !== "" || Boolean(position.institution), {
  message: "Informe o nome ou a instituição da posição",
  path: ["name"]
});

/** Rendimento sugerido ao criar uma posição: 100% do CDI para Real e Reserva, nada nas outras. */
export function defaultPositionYield(category: string) {
  return category === "cash" || category === "reserve"
    ? { yieldType: "cdi" as const, yieldRate: 1 }
    : { yieldType: "none" as const, yieldRate: 0 };
}

export const contributionSchema = z.object({
  id: z.number().int().positive().optional(),
  date: z.string().date(),
  amount: z.number().nonnegative(),
  notes: z.string().trim().optional()
});

export type Operation = z.infer<typeof operationSchema>;
export type ManualPosition = z.infer<typeof manualPositionSchema>;
export type ManualPositionInput = z.input<typeof manualPositionSchema>;
export type Contribution = z.infer<typeof contributionSchema>;
export type Portfolio = z.infer<typeof portfolioSchema>;
export type Currency = z.infer<typeof currencySchema>;

