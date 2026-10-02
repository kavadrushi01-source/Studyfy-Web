import type { Prisma, PrismaClient } from "@prisma/client";
import { AuthError } from "../auth/auth.service.js";
import { generateCertificate, type CertificatePayload, type CertificateType } from "../../lib/certificates.js";
import type { IssueCertificateInput, ListCertificatesInput } from "./certificates.schemas.js";

// Certificates (§7 Phase 2 #17): office-issued PDFs with a frozen payload
// snapshot + a human serial (CERT/<year>/<per-school sequence>). The PDF
// is regenerated from the snapshot on every download, so it always prints
// what was issued even if the pupil's record changed since. Office only
// (certificates.manage to issue, certificates.read to list/download) —
// pupils/parents hold neither key.
export async function listCertificates(
  db: PrismaClient,
  input: ListCertificatesInput,
): Promise<{
  certificates: {
    id: string;
    type: string;
    serial: string;
    student: { id: string; name: string };
    issuer: { name: string };
    createdAt: Date;
  }[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}> {
  const where: Record<string, unknown> = {};
  if (input.studentId) {
    where.studentId = input.studentId;
  }
  if (input.type) {
    where.type = input.type;
  }
  const [total, rows] = await Promise.all([
    db.certificate.count({ where }),
    db.certificate.findMany({
      where,
      select: {
        id: true,
        type: true,
        serial: true,
        student: { select: { id: true, user: { select: { name: true } } } },
        issuer: { select: { name: true } },
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
  ]);
  return {
    certificates: rows.map((r) => ({
      id: r.id,
      type: r.type,
      serial: r.serial,
      student: { id: r.student.id, name: r.student.user.name },
      issuer: { name: r.issuer.name },
      createdAt: r.createdAt,
    })),
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
  };
}

async function nextSerial(db: PrismaClient, schoolId: string): Promise<string> {
  const year = new Date().getFullYear();
  // Per-school yearly sequence from a live count inside the issue
  // transaction; the UNIQUE(schoolId, serial) index makes a rare race a
  // retryable conflict instead of a duplicate serial.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const count = await db.certificate.count({
      where: { schoolId, createdAt: { gte: new Date(`${year}-01-01T00:00:00Z`) } },
    });
    const serial = `CERT/${year}/${String(count + 1 + attempt).padStart(4, "0")}`;
    const clash = await db.certificate.findFirst({ where: { schoolId, serial }, select: { id: true } });
    if (!clash) {
      return serial;
    }
  }
  throw new AuthError(409, "SERIAL_CONFLICT", "Could not assign a certificate number, please retry.");
}

export async function issueCertificate(
  db: PrismaClient,
  callerUserId: string,
  input: IssueCertificateInput,
) {
  const student = await db.student.findFirst({
    where: { id: input.studentId },
    select: {
      id: true,
      admissionNo: true,
      schoolId: true,
      user: { select: { name: true } },
      section: { select: { name: true, class: { select: { name: true } } } },
    },
  });
  if (!student) {
    throw new AuthError(404, "STUDENT_NOT_FOUND", "Student not found in this school.");
  }
  const [school, issuer] = await Promise.all([
    db.school.findUnique({ where: { id: student.schoolId }, select: { name: true, brandColor: true } }),
    db.user.findUnique({ where: { id: callerUserId }, select: { name: true } }),
  ]);
  if (!school || !issuer) {
    throw new AuthError(500, "INTERNAL_ERROR", "Something went wrong.");
  }
  const serial = await nextSerial(db, student.schoolId);
  const payload: CertificatePayload = {
    schoolName: school.name,
    brandColor: school.brandColor ?? "#2563EB",
    studentName: student.user.name,
    admissionNo: student.admissionNo,
    className: student.section.class.name,
    sectionName: student.section.name,
    serial,
    issuedDate: new Date().toISOString().slice(0, 10),
    issuerName: issuer.name,
  };
  const record = await db.certificate.create({
    data: {
      schoolId: student.schoolId,
      studentId: student.id,
      type: input.type,
      serial,
      payload: payload as unknown as Prisma.InputJsonValue,
      issuedBy: callerUserId,
    },
    select: {
      id: true,
      type: true,
      serial: true,
      createdAt: true,
      student: { select: { id: true, user: { select: { name: true } } } },
    },
  });
  return {
    certificate: {
      id: record.id,
      type: record.type,
      serial: record.serial,
      student: { id: record.student.id, name: record.student.user.name },
      createdAt: record.createdAt,
    },
  };
}

export async function certificatePdf(db: PrismaClient, certificateId: string): Promise<{ pdf: Buffer; serial: string }> {
  const row = await db.certificate.findFirst({
    where: { id: certificateId },
    select: { type: true, serial: true, payload: true },
  });
  if (!row) {
    throw new AuthError(404, "CERTIFICATE_NOT_FOUND", "Certificate not found in this school.");
  }
  const payload = row.payload as unknown as CertificatePayload;
  const pdf = await generateCertificate(row.type as CertificateType, payload);
  return { pdf, serial: row.serial };
}
