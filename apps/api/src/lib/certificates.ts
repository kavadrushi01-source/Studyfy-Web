import PDFDocument from "pdfkit";

export const CERTIFICATE_TYPES = ["BONAFIDE", "TRANSFER", "CHARACTER"] as const;
export type CertificateType = (typeof CERTIFICATE_TYPES)[number];

export interface CertificatePayload {
  schoolName: string;
  brandColor: string;
  studentName: string;
  admissionNo: string | null;
  className: string;
  sectionName: string;
  serial: string;
  issuedDate: string;
  issuerName: string;
}

const TITLES: Record<CertificateType, string> = {
  BONAFIDE: "BONAFIDE CERTIFICATE",
  TRANSFER: "TRANSFER CERTIFICATE",
  CHARACTER: "CHARACTER CERTIFICATE",
};

function bodyLines(type: CertificateType, p: CertificatePayload): string[] {
  const who = `${p.studentName}${p.admissionNo ? ` (Admission No. ${p.admissionNo})` : ""}`;
  if (type === "BONAFIDE") {
    return [
      `This is to certify that ${who} is a bonafide student of ${p.schoolName},`,
      `studying in ${p.className} ${p.sectionName} during the academic year.`,
      ``,
      `This certificate is issued on request for whatever purpose it may serve.`,
    ];
  }
  if (type === "TRANSFER") {
    return [
      `This is to certify that ${who} was a student of ${p.schoolName},`,
      `${p.className} ${p.sectionName}.`,
      ``,
      `The student's record has been closed on request, and this transfer`,
      `certificate is issued to seek admission elsewhere.`,
    ];
  }
  return [
    `This is to certify that ${who}, a student of ${p.schoolName},`,
    `${p.className} ${p.sectionName}, bears a good moral character to the`,
    `best of our knowledge.`,
    ``,
    `We wish the student success in all future endeavours.`,
  ];
}

// Certificate PDF (§7 Phase 2 #17). PDFKit, same free-tier reasoning as
// receipts/report cards (spec §2: no browser process). A4 portrait with a
// double frame, school header in brand color, frozen snapshot content —
// re-downloads years later print exactly what was issued, because the
// route regenerates from the stored payload, never live records.
export function generateCertificate(type: CertificateType, p: CertificatePayload): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: 40, bottom: 40, left: 48, right: 48 } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", (err: Error) => reject(err));

    const brand = /^#[0-9a-fA-F]{6}$/.test(p.brandColor) ? p.brandColor : "#2563EB";
    const pageW = 595.28;
    const pageH = 841.89;

    doc.rect(24, 24, pageW - 48, pageH - 48).lineWidth(2).stroke(brand);
    doc.rect(32, 32, pageW - 64, pageH - 64).lineWidth(0.75).stroke("#CBD5E1");

    doc.moveDown(2);
    doc.fillColor(brand).fontSize(22).font("Helvetica-Bold");
    doc.text(p.schoolName, { align: "center" });
    doc.moveDown(0.4);
    doc.fillColor("#0F172A").fontSize(16).font("Helvetica-Bold");
    doc.text(TITLES[type], { align: "center" });
    doc.moveDown(0.3);
    doc.fillColor("#64748B").fontSize(10).font("Helvetica");
    doc.text(`Certificate No: ${p.serial}    •    Date: ${p.issuedDate}`, { align: "center" });
    doc.moveDown(1.2);

    doc.fillColor("#1E293B").fontSize(12).font("Helvetica");
    for (const line of bodyLines(type, p)) {
      if (line === "") {
        doc.moveDown(0.6);
      } else {
        doc.text(line, { align: "center" });
        doc.moveDown(0.15);
      }
    }

    doc.moveDown(3);
    const sigY = doc.y;
    doc.fillColor("#0F172A").fontSize(11).font("Helvetica");
    doc.text("Issued by", 90, sigY);
    doc.text("Principal", pageW - 220, sigY);
    doc.fillColor("#64748B").fontSize(10).font("Helvetica");
    doc.text(p.issuerName, 90, sigY + 16);
    doc.text(p.schoolName, pageW - 220, sigY + 16, { width: 160 });

    doc.end();
  });
}
