import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { AuthError } from "../auth/auth.service.js";
import { admitStudent, type AdmittedGuardian } from "./students.service.js";

// Bulk CSV import (§7 Phase 0, §16.1): one file, one row per pupil, every
// row reported — imported or refused with its exact reason. Never silent,
// never half-created per row.
// - Shape: the single-admission endpoint's rules, reused literally — each
//   row goes through admitStudent(), so temp passwords (per-account random,
//   §13.3), guardian reuse, EMAIL_TAKEN, the plan cap (409), and USER_CREATE
//   audit behave EXACTLY like the front-desk flow. The cap counts rows
//   imported earlier in the same file, because admission counts the DB.
// - Atomicity is per row, not per file (founder-approved semantics): good
//   rows import, bad rows land in `refused` with row number + code. An
//   UNEXPECTED error (DB down mid-file) aborts the rest as IMPORT_ABORTED
//   with the completed results kept — still nothing silent.
// - Row numbers count data rows from 1 (the header is not a row).
// - No new deps: the parser below is hand-rolled (~50 lines) and tested.

export const CSV_MAX_BYTES = 2 * 1024 * 1024;
export const CSV_MAX_ROWS = 500;

// Canonical header, matched case-insensitively after trimming.
const HEADERS = [
  "studentname",
  "studentemail",
  "section",
  "admissionno",
  "guardianname",
  "guardianemail",
  "guardianrelationship",
] as const;

const csvRowSchema = z.object({
  studentName: z.string().trim().min(2).max(120),
  studentEmail: z.string().trim().email().max(160),
  section: z.string().trim().min(1).max(80),
  admissionNo: z.string().trim().max(40).optional(),
  guardianName: z.string().trim().min(2).max(120),
  guardianEmail: z.string().trim().email().max(160),
  guardianRelationship: z.string().trim().min(2).max(40).default("Guardian"),
});

export type CsvRowInput = z.infer<typeof csvRowSchema>;

export interface ImportedRow {
  row: number;
  studentId: string;
  name: string;
  email: string;
  // One-time display (same rule as single admission): hand to the family,
  // never stored, never logged, never returned again.
  studentTempPassword: string;
  guardians: { name: string; email: string; tempPassword: string | null }[];
}

export interface RefusedRow {
  row: number;
  email: string | null;
  code: string;
  message: string;
}

export interface ImportReport {
  summary: { total: number; imported: number; refused: number };
  imported: ImportedRow[];
  refused: RefusedRow[];
}

// Minimal RFC-4180 reader: quoted fields ("" escapes), commas and CRLF
// inside quotes, trailing newline tolerated. Throws 400 on unterminated
// quotes or NUL bytes (binary masquerading as .csv).
export function parseCsv(buffer: Buffer): string[][] {
  const text = buffer.toString("utf8");
  if (text.includes("\0")) {
    throw new AuthError(400, "VALIDATION_ERROR", "The file is not a text CSV file.");
  }
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          quoted = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      i += 1;
    } else if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
    } else if (ch === "\r") {
      i += 1;
    } else if (ch === "\n") {
      row.push(field);
      field = "";
      // Skip fully blank lines (trailing newline, spreadsheet padding) —
      // they are not rows and never appear in the report.
      if (row.some((cell) => cell.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      i += 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  if (quoted) {
    throw new AuthError(400, "VALIDATION_ERROR", "The CSV has an unterminated quoted field.");
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) {
    rows.push(row);
  }
  return rows;
}

function headerError(got: string[]): AuthError {
  return new AuthError(
    400,
    "VALIDATION_ERROR",
    `CSV header must be exactly: StudentName,StudentEmail,Section,AdmissionNo,GuardianName,GuardianEmail,GuardianRelationship (got: ${got.join(",") || "(empty)"}).`,
  );
}

// "Grade 9-A" → class "Grade 9" + section "A" (split on the LAST hyphen so
// class names may contain hyphens). Scoped lookups: a foreign section name
// resolves to nothing, so cross-tenant rows refuse instead of leaking.
async function resolveSection(
  db: PrismaClient,
  schoolId: string,
  raw: string,
): Promise<string> {
  const dash = raw.lastIndexOf("-");
  if (dash <= 0) {
    throw new AuthError(
      400,
      "SECTION_NOT_FOUND",
      `Section "${raw}" must look like "Grade 9-A" (Class-Section).`,
    );
  }
  const className = raw.slice(0, dash).trim();
  const sectionName = raw.slice(dash + 1).trim();
  if (!className || !sectionName) {
    throw new AuthError(400, "SECTION_NOT_FOUND", `Section "${raw}" must look like "Grade 9-A" (Class-Section).`);
  }
  const cls = await db.class.findFirst({ where: { schoolId, name: className } });
  if (!cls) {
    throw new AuthError(400, "SECTION_NOT_FOUND", `Section "${raw}" was not found in this school.`);
  }
  const section = await db.section.findFirst({ where: { schoolId, classId: cls.id, name: sectionName } });
  if (!section) {
    throw new AuthError(400, "SECTION_NOT_FOUND", `Section "${raw}" was not found in this school.`);
  }
  return section.id;
}

function refused(row: number, email: string | null, err: unknown): RefusedRow {
  if (err instanceof AuthError) {
    return { row, email, code: err.code, message: err.message };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    return { row, email, code: "EMAIL_TAKEN", message: "An account with this email already exists in this school." };
  }
  throw err;
}

export async function importStudentsCsv(
  db: PrismaClient,
  schoolId: string,
  actorId: string,
  buffer: Buffer,
): Promise<ImportReport> {
  const table = parseCsv(buffer);
  const header = table[0] ?? [];
  const normalized = header.map((h) => h.trim().toLowerCase());
  const expected = [...HEADERS];
  if (normalized.length !== expected.length || !normalized.every((h, i) => h === expected[i])) {
    throw headerError(header.map((h) => h.trim()));
  }
  const dataRows = table.slice(1);
  if (dataRows.length === 0) {
    throw new AuthError(400, "EMPTY_FILE", "The CSV has a header but no student rows.");
  }
  if (dataRows.length > CSV_MAX_ROWS) {
    throw new AuthError(
      400,
      "TOO_MANY_ROWS",
      `The CSV has ${dataRows.length} rows; at most ${CSV_MAX_ROWS} per import. Split the file and retry.`,
    );
  }

  const imported: ImportedRow[] = [];
  const refusedRows: RefusedRow[] = [];
  const seenEmails = new Set<string>();
  let aborted = false;

  for (let index = 0; index < dataRows.length; index += 1) {
    // Data rows count from 1 (the header is not a row).
    const row = index + 1;
    if (aborted) {
      refusedRows.push({
        row,
        email: null,
        code: "IMPORT_ABORTED",
        message: "Import stopped after an unexpected error; rows above keep their stated results.",
      });
      continue;
    }
    const cells = dataRows[index] as string[];
    const email = (cells[1] ?? "").trim() || null;
    try {
      if (cells.length !== expected.length) {
        throw new AuthError(400, "VALIDATION_ERROR", `Row has ${cells.length} columns; the header has ${expected.length}.`);
      }
      const parsed = csvRowSchema.safeParse({
        studentName: cells[0],
        studentEmail: cells[1],
        section: cells[2],
        admissionNo: (cells[3] ?? "").trim() === "" ? undefined : cells[3],
        guardianName: cells[4],
        guardianEmail: cells[5],
        guardianRelationship: (cells[6] ?? "").trim() === "" ? undefined : cells[6],
      });
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        throw new AuthError(400, "VALIDATION_ERROR", `Row ${row}: ${first?.path.join(".") ?? "field"} — ${first?.message ?? "invalid value."}`);
      }
      const key = parsed.data.studentEmail.toLowerCase();
      if (seenEmails.has(key)) {
        throw new AuthError(409, "DUPLICATE_ROW", `Row ${row}: ${parsed.data.studentEmail} already appears earlier in this file.`);
      }
      seenEmails.add(key);
      const sectionId = await resolveSection(db, schoolId, parsed.data.section);
      const result = await admitStudent(
        db,
        {
          name: parsed.data.studentName,
          email: parsed.data.studentEmail,
          sectionId,
          admissionNo: parsed.data.admissionNo,
          guardians: [
            {
              name: parsed.data.guardianName,
              email: parsed.data.guardianEmail,
              relationship: parsed.data.guardianRelationship,
            },
          ],
        },
        actorId,
      );
      const guardians: AdmittedGuardian[] = result.guardians;
      imported.push({
        row,
        studentId: result.student.id,
        name: result.student.user.name,
        email: result.student.user.email,
        studentTempPassword: result.studentTempPassword,
        guardians: guardians.map((g) => ({ name: g.user.name, email: g.user.email, tempPassword: g.tempPassword })),
      });
    } catch (err) {
      try {
        refusedRows.push(refused(row, email, err));
      } catch (unexpected) {
        // An unexpected failure (DB down mid-file): this row and every
        // remaining row refuse loudly — nothing silent, nothing half-made.
        aborted = true;
        const message = unexpected instanceof Error ? unexpected.message : "Unexpected import error.";
        refusedRows.push({ row, email, code: "IMPORT_ABORTED", message: `Row ${row}: ${message} No further rows were attempted.` });
      }
    }
  }

  return {
    summary: { total: dataRows.length, imported: imported.length, refused: refusedRows.length },
    imported,
    refused: refusedRows,
  };
}
