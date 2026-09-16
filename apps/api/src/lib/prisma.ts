import { PrismaClient } from "@prisma/client";

// One shared client for the whole Express process (spec §12.3).
// Aiven's free MySQL caps connections — never `new PrismaClient()` per
// request. Per-request tenant scoping wraps THIS instance (see
// SECURITY_PATTERNS.md), it doesn't replace it.
export const prisma = new PrismaClient();
