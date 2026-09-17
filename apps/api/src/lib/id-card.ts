import PDFDocument from "pdfkit";

export interface IdCardData {
  schoolName: string;
  brandColor: string;
  studentName: string;
  admissionNo: string | null;
  className: string;
  sectionName: string;
  dob: Date | null;
}

// Student ID card PDF (SIS §7 Phase 1 #1). PDFKit — renders directly, no
// browser process, safe on Render's free-tier memory (spec §2 bans
// Puppeteer for exactly this reason). CR80-ish landscape card.
export function generateStudentIdCard(data: IdCardData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [324, 204], margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", (err: Error) => reject(err));

    const brand = /^#[0-9a-fA-F]{6}$/.test(data.brandColor) ? data.brandColor : "#2563EB";

    // Header band in the school's brand color.
    doc.rect(0, 0, 324, 52).fill(brand);
    doc.fillColor("#ffffff").fontSize(13).font("Helvetica-Bold");
    doc.text(data.schoolName, 12, 12, { width: 300, ellipsis: true });
    doc.fontSize(8).font("Helvetica");
    doc.text("STUDENT IDENTITY CARD", 12, 32);

    // Photo placeholder: initials box (a real PHOTO document renders here
    // once the admission flow attaches one — same box, same geometry).
    const initials = data.studentName
      .split(/\s+/)
      .map((part) => part[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase();
    doc.rect(12, 64, 64, 76).fill("#F1F5F9").stroke("#CBD5E1");
    doc.fillColor(brand).fontSize(22).font("Helvetica-Bold");
    doc.text(initials, 12, 92, { width: 64, align: "center" });

    // Details.
    doc.fillColor("#0F172A").fontSize(12).font("Helvetica-Bold");
    doc.text(data.studentName, 88, 66, { width: 224, ellipsis: true });
    doc.fontSize(9).font("Helvetica").fillColor("#334155");
    const lines: [string, string][] = [
      ["Adm. no", data.admissionNo ?? "—"],
      ["Class", `${data.className} · ${data.sectionName}`],
      ["DOB", data.dob ? data.dob.toISOString().slice(0, 10) : "—"],
    ];
    let y = 88;
    for (const [label, value] of lines) {
      doc.text(`${label}:`, 88, y);
      doc.font("Helvetica-Bold").text(value, 140, y, { width: 172, ellipsis: true }).font("Helvetica");
      y += 14;
    }

    // Footer band.
    doc.rect(0, 184, 324, 20).fill(brand);
    doc.fillColor("#ffffff").fontSize(7);
    doc.text("If found, please return to the school office.", 12, 190, { width: 300, align: "center" });

    doc.end();
  });
}
