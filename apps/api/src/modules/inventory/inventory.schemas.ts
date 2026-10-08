import { z } from "zod";

// Inventory (§7 Phase 3 #22): school stock with movement-only quantity
// changes. Names are unique per school (the shelf label); SKU is an
// optional supplier code. Quantities are whole units — this tracks boxes
// of chalk, not milliliters of reagent.
export const createItemSchema = z.object({
  name: z.string().trim().min(2).max(80),
  sku: z.string().trim().max(64).optional(),
  category: z.string().trim().min(1).max(40).default("General"),
  unit: z.string().trim().min(1).max(20).default("pcs"),
  reorderLevel: z.number().int().min(0).max(1000000).default(0),
});

export type CreateItemInput = z.infer<typeof createItemSchema>;

export const updateItemSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    category: z.string().trim().min(1).max(40).optional(),
    unit: z.string().trim().min(1).max(20).optional(),
    reorderLevel: z.number().int().min(0).max(1000000).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Provide at least one field to update.",
  });

export type UpdateItemInput = z.infer<typeof updateItemSchema>;

// No ADJUST type by design: corrections are explicit IN/OUT rows with a
// reason, so history always explains the counter. Quantity bounds keep one
// call inside sane terminal-operator range.
export const moveStockSchema = z.object({
  type: z.enum(["IN", "OUT"]),
  quantity: z.number().int().min(1).max(100000),
  reason: z.string().trim().max(500).optional(),
});

export type MoveStockInput = z.infer<typeof moveStockSchema>;

export const listItemsQuerySchema = z.object({
  search: z.string().trim().max(80).optional(),
  category: z.string().trim().max(40).optional(),
  lowStock: z.coerce.boolean().optional(),
});

export type ListItemsQuery = z.infer<typeof listItemsQuerySchema>;
