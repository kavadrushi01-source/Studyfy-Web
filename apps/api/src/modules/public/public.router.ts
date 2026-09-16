import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { catchAsync } from "../../lib/async.js";
import { prisma } from "../../lib/prisma.js";
import { enquiryLimiter } from "../../middleware/security.js";

export const publicRouter = Router();

const enquirySchema = z
  .object({
    schoolSlug: z.string().trim().min(1).max(80),
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().max(30).optional(),
    email: z.string().trim().email().max(160).optional(),
    message: z.string().trim().min(10).max(2000),
    // Honeypot (§13.5): real users never see/fill this field. Bots do —
    // they get a fake success and the spam is silently dropped.
    website: z.string().max(200).optional(),
  })
  .refine((v) => v.phone ?? v.email, {
    message: "Provide at least one contact: phone or email.",
  });

// POST /api/v1/public/enquiries — the one unauthenticated form in the app
// (spec §10), so: rate-limited + honeypot + validated. Uses the raw client
// (no JWT exists yet — same exemption as register, §13.4). Reads later go
// through tenant routes; the Phase 2 CRM pipeline (#16) builds on this.
publicRouter.post(
  "/enquiries",
  enquiryLimiter(),
  catchAsync(async (req: Request, res: Response) => {
    const parsed = enquirySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        data: null,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid request body." },
        meta: null,
      });
      return;
    }
    if (parsed.data.website && parsed.data.website.length > 0) {
      // Spam trap: pretend success, store nothing.
      res.status(201).json({
        success: true,
        data: { received: true },
        error: null,
        meta: null,
      });
      return;
    }
    const school = await prisma.school.findUnique({ where: { slug: parsed.data.schoolSlug } });
    if (!school) {
      res.status(404).json({
        success: false,
        data: null,
        error: { code: "SCHOOL_NOT_FOUND", message: "No school found for that reference." },
        meta: null,
      });
      return;
    }
    const enquiry = await prisma.enquiry.create({
      data: {
        schoolId: school.id,
        name: parsed.data.name,
        phone: parsed.data.phone,
        email: parsed.data.email,
        message: parsed.data.message,
      },
    });
    res.status(201).json({ success: true, data: { received: true, id: enquiry.id }, error: null, meta: null });
  }),
);
