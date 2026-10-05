import PDFDocument from "pdfkit";

export interface SalarySlipData {
  schoolName: string;
  brandColor: string;
  slipNo: string;
  staffName: string;
  designation: string;
  month: string;
  baseSalary: string;
  deductions: string;
  deductionDetail: string;
  netPay: string;
  generatedAt: Date;
}

// Monthly salary slip (§7 Phase 2 #15). PDFKit, same setup as fee
// receipts (spec §2: no browser process on free-tier memory). A4,
// print-ready. Amounts arrive pre-formatted (Decimal-exact strings).
export function generateSalarySlip(data: SalarySlipData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: 48, bottom: 48, left: 56, right: 56 } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", (err: Error) => reject(err));

    const brand = /^#[0-9a-fA-F]{6}$/.test(data.brandColor) ? data.brandColor : "#2563EB";

    doc.fillColor(brand).fontSize(20).font("Helvetica-Bold");
    doc.text(data.schoolName, { align: "center" });
    doc.fillColor("#64748B").fontSize(10).font("Helvetica");
    doc.text("SALARY SLIP", { align: "center" });
    doc.moveDown(0.5);
    doc.fillColor("#0F172A").fontSize(10);
    doc.text(`Slip no: ${data.slipNo}`, { align: "center" });
    doc.text(`Month: ${data.month}`, { align: "center" });
    doc.moveDown();

    doc.rect(doc.x, doc.y, 483, 1).fill("#E2E8F0");
    doc.moveDown();

    const rows: [string, string][] = [
      ["Staff", `${data.staffName} (${data.designation})`],
      ["Base salary", `Rs.${data.baseSalary}`],
      ["Deductions", `Rs.${data.deductions}`],
      ["Deduction detail", data.deductionDetail],
      ["Net pay", `Rs.${data.netPay}`],
      ["Generated", data.generatedAt.toISOString().slice(0, 10)],
    ];
    for (const [label, value] of rows) {
      doc.fillColor("#64748B").fontSize(10).font("Helvetica");
      doc.text(label, { continued: true });
      doc.fillColor("#0F172A").font("Helvetica-Bold");
      doc.text(`  ${value}`);
      doc.font("Helvetica");
      doc.moveDown(0.35);
    }

    doc.moveDown();
    doc.fillColor("#64748B").fontSize(8);
    doc.text("This is a computer-generated slip and needs no signature.", { align: "center" });

    doc.end();
  });
}
