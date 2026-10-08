import { Prisma, type PrismaClient } from "@prisma/client";
import { AuthError } from "../auth/auth.service.js";
import type { CreateItemInput, ListItemsQuery, MoveStockInput, UpdateItemInput } from "./inventory.schemas.js";

// Quantities move ONLY through movement rows: the item counter is
// recomputed inside the same transaction that writes the row, and an OUT
// that would drive it negative is refused with 409 — the shelf can never
// show stock that was never received (same discipline as library copies).
export async function createItem(db: PrismaClient, schoolId: string, input: CreateItemInput) {
  try {
    const item = await db.inventoryItem.create({
      data: {
        schoolId,
        name: input.name,
        sku: input.sku,
        category: input.category,
        unit: input.unit,
        reorderLevel: input.reorderLevel,
      },
    });
    return { item: publicItem(item) };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AuthError(409, "ITEM_EXISTS", "An item with that name already exists in this school.");
    }
    throw err;
  }
}

function publicItem(item: {
  id: string;
  name: string;
  sku: string | null;
  category: string;
  unit: string;
  quantity: number;
  reorderLevel: number;
}) {
  return { ...item, lowStock: item.quantity <= item.reorderLevel };
}

export async function listItems(db: PrismaClient, schoolId: string, query: ListItemsQuery) {
  const rows = await db.inventoryItem.findMany({
    where: {
      schoolId,
      ...(query.category ? { category: query.category } : {}),
      ...(query.search
        ? { OR: [{ name: { contains: query.search } }, { sku: { contains: query.search } }] }
        : {}),
    },
    orderBy: { name: "asc" },
    take: 200,
  });
  const items = rows.map(publicItem);
  return { items: query.lowStock ? items.filter((i) => i.lowStock) : items };
}

export async function updateItem(
  db: PrismaClient,
  schoolId: string,
  itemId: string,
  input: UpdateItemInput,
) {
  const item = await db.inventoryItem.findFirst({ where: { id: itemId, schoolId } });
  if (!item) {
    throw new AuthError(404, "ITEM_NOT_FOUND", "Item not found in this school.");
  }
  try {
    const updated = await db.inventoryItem.update({
      where: { id: item.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.unit !== undefined ? { unit: input.unit } : {}),
        ...(input.reorderLevel !== undefined ? { reorderLevel: input.reorderLevel } : {}),
      },
    });
    return { item: publicItem(updated) };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AuthError(409, "ITEM_EXISTS", "An item with that name already exists in this school.");
    }
    throw err;
  }
}

export async function moveStock(
  db: PrismaClient,
  schoolId: string,
  callerUserId: string,
  itemId: string,
  input: MoveStockInput,
) {
  const item = await db.inventoryItem.findFirst({ where: { id: itemId, schoolId } });
  if (!item) {
    throw new AuthError(404, "ITEM_NOT_FOUND", "Item not found in this school.");
  }
  // The stock guard MUST live inside the transaction (library precedent):
  // two counters moving the last units concurrently would otherwise both
  // pass an outside check and drive the shelf negative. The conditional
  // decrement is the atomic gate — zero affected rows means too few left.
  if (input.type === "IN") {
    const [updated, movement] = await db.$transaction([
      db.inventoryItem.update({ where: { id: item.id }, data: { quantity: { increment: input.quantity } } }),
      db.inventoryMovement.create({
        data: {
          schoolId,
          itemId: item.id,
          type: "IN",
          quantity: input.quantity,
          reason: input.reason,
          createdBy: callerUserId,
        },
      }),
    ]);
    return {
      item: publicItem(updated),
      movement: { id: movement.id, type: movement.type, quantity: movement.quantity },
    };
  }
  const outcome = await db.$transaction(async (tx) => {
    const claimed = await tx.inventoryItem.updateMany({
      where: { id: item.id, schoolId, quantity: { gte: input.quantity } },
      data: { quantity: { decrement: input.quantity } },
    });
    if (claimed.count === 0) {
      const fresh = await tx.inventoryItem.findFirst({ where: { id: item.id, schoolId } });
      if (!fresh) {
        throw new AuthError(404, "ITEM_NOT_FOUND", "Item not found in this school.");
      }
      throw new AuthError(
        409,
        "INSUFFICIENT_STOCK",
        `Only ${fresh.quantity} ${fresh.unit} on hand — cannot move ${input.quantity} out.`,
      );
    }
    const movement = await tx.inventoryMovement.create({
      data: {
        schoolId,
        itemId: item.id,
        type: "OUT",
        quantity: input.quantity,
        reason: input.reason,
        createdBy: callerUserId,
      },
    });
    const updated = await tx.inventoryItem.findFirstOrThrow({ where: { id: item.id } });
    return { updated, movement };
  });
  return {
    item: publicItem(outcome.updated),
    movement: { id: outcome.movement.id, type: outcome.movement.type, quantity: outcome.movement.quantity },
  };
}

export async function itemHistory(db: PrismaClient, schoolId: string, itemId: string) {
  const item = await db.inventoryItem.findFirst({ where: { id: itemId, schoolId } });
  if (!item) {
    throw new AuthError(404, "ITEM_NOT_FOUND", "Item not found in this school.");
  }
  const rows = await db.inventoryMovement.findMany({
    where: { schoolId, itemId: item.id },
    select: {
      id: true,
      type: true,
      quantity: true,
      reason: true,
      createdAt: true,
      creator: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return {
    item: publicItem(item),
    movements: rows.map((r) => ({ ...r, creatorName: r.creator.name })),
  };
}
