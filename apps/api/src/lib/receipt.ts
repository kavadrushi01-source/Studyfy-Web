import PDFDocument from "pdfkit";

export interface ReceiptData {
  schoolName: string;
  brandColor: string;
  receiptNo: string;
  studentName: string;
  structureName: string;
  invoiceAmount: string;
  paidNow: string;
  totalPaid: string;
  balance: string;
  status: string;
  method: string;
  paidAt: Date;
  receivedBy: string;
}

// Fee receipt PDF (§7 Phase 1 #3). PDFKit — same reasoning as ID cards
// (spec §2: no browser process on free-tier memory). A4, print-ready.
export function generateFeeReceipt(data: ReceiptData): Promise<Buffer> {
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
    doc.text("FEE RECEIPT", { align: "center" });
    doc.moveDown(0.5);
    doc.fillColor("#0F172A").fontSize(10);
    doc.text(`Receipt no: ${data.receiptNo}`, { align: "center" });
    doc.text(`Date: ${data.paidAt.toISOString().slice(0, 10)}`, { align: "center" });
    doc.moveDown();

    doc.rect(doc.x, doc.y, 483, 1).fill("#E2E8F0");
    doc.moveDown();

    const rows: [string, string][] = [
      ["Student", data.studentName],
      ["Fee head", data.structureName],
      ["Invoice total", data.invoiceAmount],
      ["Paid now", data.paidNow],
      ["Total paid", data.totalPaid],
      ["Balance due", data.balance],
      ["Method", data.method],
      ["Received by", data.receivedBy],
      ["Status", data.status],
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
    doc.text("This is a computer-generated receipt and needs no signature.", { align: "center" });

    doc.end();
  });
}
