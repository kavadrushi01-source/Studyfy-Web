import { Router, type Request, type Response } from "express";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { AuthError } from "../auth/auth.service.js";
import {
  createItemSchema,
  listItemsQuerySchema,
  moveStockSchema,
  updateItemSchema,
} from "./inventory.schemas.js";
import { createItem, itemHistory, listItems, moveStock, updateItem } from "./inventory.service.js";

export const inventoryRouter = Router();

function sendInventoryError(res: Response, err: unknown): void {
  if (err instanceof AuthError) {
    res.status(err.status).json({ success: false, data: null, error: { code: err.code, message: err.message }, meta: null });
    return;
  }
  throw err;
}

inventoryRouter.get(
  "/schools/:schoolId/inventory/items",
  authMiddleware,
  tenantMiddleware,
  requirePermission("inventory.read"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      return;
    }
    const parsed = listItemsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        data: null,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid query." },
        meta: null,
      });
      return;
    }
    try {
      const result = await listItems(req.prisma, req.schoolId ?? "", parsed.data);
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendInventoryError(res, err);
    }
  }),
);

inventoryRouter.post(
  "/schools/:schoolId/inventory/items",
  authMiddleware,
  tenantMiddleware,
  requirePermission("inventory.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      return;
    }
    const parsed = createItemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        data: null,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid request body." },
        meta: null,
      });
      return;
    }
    try {
      const result = await createItem(req.prisma, req.schoolId ?? "", parsed.data);
      res.status(201).json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendInventoryError(res, err);
    }
  }),
);

inventoryRouter.patch(
  "/schools/:schoolId/inventory/items/:itemId",
  authMiddleware,
  tenantMiddleware,
  requirePermission("inventory.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      return;
    }
    const parsed = updateItemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        data: null,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid request body." },
        meta: null,
      });
      return;
    }
    try {
      const result = await updateItem(req.prisma, req.schoolId ?? "", req.params.itemId ?? "", parsed.data);
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendInventoryError(res, err);
    }
  }),
);

inventoryRouter.post(
  "/schools/:schoolId/inventory/items/:itemId/movements",
  authMiddleware,
  tenantMiddleware,
  requirePermission("inventory.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma || !req.user) {
      res.status(500).json({
        success: false,
        data: null,
        error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
        meta: null,
      });
      return;
    }
    const parsed = moveStockSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        data: null,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid request body." },
        meta: null,
      });
      return;
    }
    try {
      const result = await moveStock(req.prisma, req.schoolId ?? "", req.user.userId, req.params.itemId ?? "", parsed.data);
      res.status(201).json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendInventoryError(res, err);
    }
  }),
);

inventoryRouter.get(
  "/schools/:schoolId/inventory/items/:itemId/movements",
  authMiddleware,
  tenantMiddleware,
  requirePermission("inventory.read"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      return;
    }
    try {
      const result = await itemHistory(req.prisma, req.schoolId ?? "", req.params.itemId ?? "");
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendInventoryError(res, err);
    }
  }),
);
