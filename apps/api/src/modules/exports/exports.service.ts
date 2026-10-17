import type { PrismaClient } from "@prisma/client";
import { pickAuditFields, recordAudit } from "../../lib/audit.js";
import { AuthError } from "../auth/auth.service.js";

export interface ExportManifest {
  school: { id: string; name: string; slug: string };
  exportedAt: string;
  exportId: string;
  exporterId: string;
  exporterRole: string;
  // Owner exports carry the recorded reason; a school exporting itself has
  // none to give (it is their own data).
  reason: string | null;
  files: string[];
  counts: Record<string, number>;
}

// School data export (§13.10, §7 #26) — the highest-blast-radius read in
// the product, so the shape is deliberately boring: one JSON file per
// table, every row filtered by the schoolId parameter, secrets excluded by
// construction (never "dump and strip").
//
// Tenant-isolation contract: EVERY query below filters by schoolId. The
// tenant route passes the request-scoped client (double-pinned), the owner
// route passes the raw client with the explicit id (single pin, same
// filter). Callers must pass the client scoped to schoolId — there is no
// other caller.
// Secrets contract (§13.10): User rows WITHOUT passwordHash; the
// auth/refresh token tables are never queried at all; biometric devices
// WITHOUT apiKeyHash; gateway order/payment ids stay (transaction refs,
// not instruments — the enumerated secret list names hashes and keys).
// Internal ticket notes are EXCLUDED: owner-authored, never visible to the
// school — exporting them would leak the support privacy boundary.
export async function buildExportFiles(
  db: PrismaClient,
  schoolId: string,
): Promise<{ files: Record<string, string>; counts: Record<string, number>; school: { id: string; name: string; slug: string } }> {
  const school = await db.school.findUnique({
    where: { id: schoolId },
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      address: true,
      city: true,
      state: true,
      brandColor: true,
      phone: true,
      email: true,
      timezone: true,
      isDemo: true,
      trialEndsAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!school) {
    throw new AuthError(404, "SCHOOL_NOT_FOUND", "School not found.");
  }

  const files: Record<string, string> = {};
  const counts: Record<string, number> = {};
  async function put(name: string, rows: unknown): Promise<void> {
    const list = Array.isArray(rows) ? rows : [rows];
    files[name] = JSON.stringify(list, null, 2);
    counts[name.replace(/\.json$/, "")] = list.length;
  }
  const bySchool = { schoolId };

  await put("school.json", school);
  await put(
    "users.json",
    await db.user.findMany({
      where: bySchool,
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        role: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  );
  await put("academic_years.json", await db.academicYear.findMany({ where: bySchool, orderBy: { startDate: "asc" } }));
  await put("subjects.json", await db.subject.findMany({ where: bySchool, orderBy: { name: "asc" } }));
  await put("classes.json", await db.class.findMany({ where: bySchool, orderBy: { name: "asc" } }));
  await put("sections.json", await db.section.findMany({ where: bySchool, orderBy: { name: "asc" } }));
  await put(
    "students.json",
    await db.student.findMany({
      where: bySchool,
      select: {
        id: true,
        userId: true,
        sectionId: true,
        admissionNo: true,
        rollNumber: true,
        deviceUserId: true,
        dob: true,
        gender: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
  );
  await put("student_guardians.json", await db.studentGuardian.findMany({ where: bySchool }));
  await put(
    "staff.json",
    await db.staff.findMany({
      where: bySchool,
      select: {
        id: true,
        userId: true,
        employeeId: true,
        designation: true,
        qualification: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
  );
  await put("teacher_subjects.json", await db.teacherSubject.findMany({ where: bySchool }));
  await put("attendance.json", await db.attendance.findMany({ where: bySchool, orderBy: { date: "asc" } }));
  await put("staff_attendance.json", await db.staffAttendance.findMany({ where: bySchool, orderBy: { date: "asc" } }));
  await put("leave_requests.json", await db.leaveRequest.findMany({ where: bySchool, orderBy: { createdAt: "asc" } }));
  await put("payroll.json", await db.payroll.findMany({ where: bySchool, orderBy: { month: "asc" } }));
  await put("fee_structures.json", await db.feeStructure.findMany({ where: bySchool }));
  await put("fee_invoices.json", await db.feeInvoice.findMany({ where: bySchool, orderBy: { dueDate: "asc" } }));
  await put("fee_payments.json", await db.feePayment.findMany({ where: bySchool, orderBy: { paidAt: "asc" } }));
  await put("exams.json", await db.exam.findMany({ where: bySchool, orderBy: { createdAt: "asc" } }));
  await put("exam_subjects.json", await db.examSubject.findMany({ where: bySchool }));
  await put("marks.json", await db.mark.findMany({ where: bySchool }));
  await put("exam_remarks.json", await db.examRemark.findMany({ where: bySchool }));
  await put("timetable_slots.json", await db.timetableSlot.findMany({ where: bySchool }));
  await put("homework.json", await db.homework.findMany({ where: bySchool, orderBy: { dueDate: "asc" } }));
  await put("homework_submissions.json", await db.homeworkSubmission.findMany({ where: bySchool }));
  await put("notices.json", await db.notice.findMany({ where: bySchool, orderBy: { createdAt: "asc" } }));
  await put("enquiries.json", await db.enquiry.findMany({ where: bySchool, orderBy: { createdAt: "asc" } }));
  await put("enquiry_notes.json", await db.enquiryNote.findMany({ where: bySchool }));
  await put("messages.json", await db.message.findMany({ where: bySchool, orderBy: { createdAt: "asc" } }));
  await put("tickets.json", await db.ticket.findMany({ where: bySchool, orderBy: { createdAt: "asc" } }));
  await put(
    "ticket_messages.json",
    await db.ticketMessage.findMany({ where: { ...bySchool, isInternal: false }, orderBy: { createdAt: "asc" } }),
  );
  // Attachments inherit their message's privacy: owner-internal screenshots
  // stay out of a school's archive, exactly like internal message bodies.
  await put(
    "ticket_attachments.json",
    await db.ticketAttachment.findMany({
      where: { ...bySchool, message: { isInternal: false } },
      orderBy: { createdAt: "asc" },
    }),
  );
  await put("books.json", await db.book.findMany({ where: bySchool, orderBy: { title: "asc" } }));
  await put("book_loans.json", await db.bookLoan.findMany({ where: bySchool }));
  await put("vehicles.json", await db.vehicle.findMany({ where: bySchool }));
  await put("transport_routes.json", await db.transportRoute.findMany({ where: bySchool }));
  await put("student_routes.json", await db.studentRoute.findMany({ where: bySchool }));
  await put("certificates.json", await db.certificate.findMany({ where: bySchool }));
  await put("documents.json", await db.document.findMany({ where: bySchool }));
  await put("inventory_items.json", await db.inventoryItem.findMany({ where: bySchool }));
  await put("inventory_movements.json", await db.inventoryMovement.findMany({ where: bySchool }));
  await put(
    "biometric_devices.json",
    await db.biometricDevice.findMany({
      where: bySchool,
      select: {
        id: true,
        name: true,
        location: true,
        isActive: true,
        lastSyncAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  );
  await put("subscription.json", await db.subscription.findUnique({ where: { schoolId } }));
  await put("subscription_invoices.json", await db.subscriptionInvoice.findMany({ where: bySchool }));
  await put(
    "audit_logs.json",
    await db.auditLog.findMany({
      where: bySchool,
      select: {
        id: true,
        actorId: true,
        impersonatedBy: true,
        action: true,
        entity: true,
        entityId: true,
        before: true,
        after: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
  );

  return { files, counts, school: { id: school.id, name: school.name, slug: school.slug } };
}

export async function recordExportAudit(
  db: PrismaClient,
  input: { schoolId: string; exporterId: string; reason: string | null; exportId: string; fileCount: number },
): Promise<void> {
  await recordAudit(db, {
    schoolId: input.schoolId,
    actorId: input.exporterId,
    action: "DATA_EXPORT",
    entity: "Export",
    entityId: input.exportId,
    after: pickAuditFields("Export", {
      id: input.exportId,
      exporterId: input.exporterId,
      reason: input.reason,
      fileCount: input.fileCount,
    }),
  });
}
