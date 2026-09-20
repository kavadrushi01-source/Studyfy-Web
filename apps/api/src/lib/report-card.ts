import PDFDocument from "pdfkit";

export interface ReportSubject {
  name: string;
  max: number;
  obtained: number;
  percent: number;
  grade: string;
}

export interface ReportCardData {
  schoolName: string;
  brandColor: string;
  examName: string;
  studentName: string;
  admissionNo: string | null;
  className: string;
  sectionName: string;
  subjects: ReportSubject[];
  total: number;
  max: number;
  percent: number;
  grade: string;
  rank: number;
  rankedOutOf: number;
  attendancePercent: number | null;
  attendanceRange: string | null;
}

// Report card PDF (§7 Phase 1 #4). PDFKit, A4 — same no-browser reasoning
// as ID cards and receipts (spec §2).
export function generateReportCard(data: ReportCardData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: 48, bottom: 48, left: 56, right: 56 } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", (err: Error) => reject(err));

    const brand = /^#[0-9a-fA-F]{6}$/.test(data.brandColor) ? data.brandColor : "#2563EB";

    doc.fillColor(brand).fontSize(20).font("Helvetica-Bold");
    doc.text(data.schoolName, { align: "center" });
    doc.fillColor("#64748B").fontSize(11).font("Helvetica");
    doc.text(`Report Card — ${data.examName}`, { align: "center" });
    doc.moveDown();

    doc.fillColor("#0F172A").fontSize(10).font("Helvetica");
    doc.text(`Student: ${data.studentName}    Admission no: ${data.admissionNo ?? "—"}`);
    doc.text(`Class: ${data.className} · ${data.sectionName}`);
    doc.moveDown(0.5);

    const left = 56;
    const widths = [220, 70, 70, 60, 60];
    const headers = ["Subject", "Max", "Obtained", "%", "Grade"];
    doc.fontSize(9).font("Helvetica-Bold").fillColor("#ffffff");
    doc.rect(left, doc.y, 480, 18).fill(brand);
    let x = left + 6;
    const headerY = doc.y + 4;
    headers.forEach((h, i) => {
      doc.text(h, x, headerY, { width: (widths[i] ?? 60) - 6 });
      x += widths[i] ?? 60;
    });
    doc.moveDown(1.2);

    doc.font("Helvetica").fillColor("#0F172A");
    for (const subject of data.subjects) {
      const y = doc.y;
      const cells = [
        subject.name,
        String(subject.max),
        String(subject.obtained),
        String(subject.percent),
        subject.grade,
      ];
      let cx = left + 6;
      cells.forEach((cell, i) => {
        doc.fontSize(9).text(cell, cx, y, { width: (widths[i] ?? 60) - 6, ellipsis: true });
        cx += widths[i] ?? 60;
      });
      doc.moveDown();
      doc.rect(left, doc.y, 480, 0.5).fill("#E2E8F0");
      doc.moveDown(0.4);
    }

    doc.moveDown(0.5);
    doc.fontSize(11).font("Helvetica-Bold");
    doc.text(`Total: ${data.total} / ${data.max}    ${data.percent}%    Grade ${data.grade}`);
    doc.text(`Rank: ${data.rank} of ${data.rankedOutOf}`);
    if (data.attendancePercent !== null) {
      doc.fontSize(10).font("Helvetica").fillColor("#334155");
      doc.text(
        `Attendance: ${data.attendancePercent}%${data.attendanceRange ? ` (${data.attendanceRange})` : ""}`,
      );
    }

    doc.moveDown(2);
    doc.fillColor("#64748B").fontSize(8);
    doc.text("This is a computer-generated report card and needs no signature.", { align: "center" });

    doc.end();
  });
}
