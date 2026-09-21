import { Router, type Request, type Response } from "express";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { AuthError } from "../auth/auth.service.js";
import { sendMessageSchema, threadQuerySchema } from "./messages.schemas.js";
import { readThread, sendMessage } from "./messages.service.js";

export const messagesRouter = Router();

function sendMessagesError(res: Response, err: unknown): void {
  if (err instanceof AuthError) {
    res.status(err.status).json({ success: false, data: null, error: { code: err.code, message: err.message }, meta: null });
    return;
  }
  throw err;
}

// Send (TEACHER/PARENT/STUDENT with messages.send). WHO may reach WHOM is
// the §13.7 matrix in the service — the route only authenticates, scopes,
// and permission-checks.
messagesRouter.post(
  "/schools/:schoolId/messages",
  authMiddleware,
  tenantMiddleware,
  requirePermission("messages.send"),
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
    const parsed = sendMessageSchema.safeParse(req.body);
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
      const message = await sendMessage(
        req.prisma,
        { userId: req.user.userId, role: req.user.role },
        parsed.data.receiverId,
        parsed.data.body,
      );
      res.status(201).json({ success: true, data: { message }, error: null, meta: null });
    } catch (err) {
      sendMessagesError(res, err);
    }
  }),
);

// Read a 1:1 thread (?with=<userId>). Participants see their own threads;
// School Admin sees ANY thread in their school (oversight, §13.7).
messagesRouter.get(
  "/schools/:schoolId/messages",
  authMiddleware,
  tenantMiddleware,
  requirePermission("messages.read"),
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
    const parsed = threadQuerySchema.safeParse(req.query);
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
      const messages = await readThread(
        req.prisma,
        { userId: req.user.userId, role: req.user.role },
        parsed.data.with,
      );
      res.json({ success: true, data: { messages }, error: null, meta: null });
    } catch (err) {
      sendMessagesError(res, err);
    }
  }),
);
