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
  name: z.string().trim().min(1),
  invested: z.number().nonnegative().default(0),
  currentValue: z.number().nonnegative(),
  currency: currencySchema.default("BRL"),
  notes: z.string().trim().optional()
});

export const contributionSchema = z.object({
  id: z.number().int().positive().optional(),
  date: z.string().date(),
  amount: z.number().nonnegative(),
  notes: z.string().trim().optional()
});

export type Operation = z.infer<typeof operationSchema>;
export type ManualPosition = z.infer<typeof manualPositionSchema>;
export type Contribution = z.infer<typeof contributionSchema>;
export type Portfolio = z.infer<typeof portfolioSchema>;
export type Currency = z.infer<typeof currencySchema>;

