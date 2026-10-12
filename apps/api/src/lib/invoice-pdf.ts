import PDFDocument from "pdfkit";

export interface SubscriptionInvoiceData {
  schoolName: string;
  brandColor: string;
  invoiceNumber: string;
  financialYear: string;
  plan: string;
  periodStart: string;
  periodEnd: string;
  amountPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  status: string;
  paidMethod: string | null;
  paidAt: string | null;
}

function rupees(paise: number): string {
  return `Rs. ${(paise / 100).toFixed(2)}`;
}

// Subscription invoice PDF (§16.1). PDFKit — same reasoning as fee receipts
// (spec §2: no browser process on free-tier memory). A4, print-ready.
// TEST INVOICE — not a tax invoice — prints on EVERY invoice while this is
// a portfolio project (PLATFORM_GSTIN blank). There is deliberately NO
// GSTIN line anywhere here: a GSTIN value must come from the platform's
// real registration, and inventing one would fabricate a legal document
// (RULES.md ban, same as §8.1's fake-stats ban).
export function generateSubscriptionInvoice(data: SubscriptionInvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: 48, bottom: 48, left: 56, right: 56 } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", (err: Error) => reject(err));

    const brand = /^#[0-9a-fA-F]{6}$/.test(data.brandColor) ? data.brandColor : "#2563EB";
    const totalPaise = data.amountPaise + data.cgstPaise + data.sgstPaise + data.igstPaise;

    doc.fillColor(brand).fontSize(20).font("Helvetica-Bold");
    doc.text(data.schoolName, { align: "center" });
    doc.fillColor("#64748B").fontSize(10).font("Helvetica");
    doc.text("SUBSCRIPTION INVOICE", { align: "center" });
    doc.moveDown(0.5);
    doc.fillColor("#0F172A").fontSize(10);
    doc.text(`Invoice no: ${data.invoiceNumber}`, { align: "center" });
    doc.text(`Financial year: ${data.financialYear}`, { align: "center" });
    doc.text(`Period: ${data.periodStart} to ${data.periodEnd}`, { align: "center" });
    doc.moveDown();

    doc.rect(doc.x, doc.y, 483, 1).fill("#E2E8F0");
    doc.moveDown();

    const rows: [string, string][] = [
      ["Plan", data.plan],
      ["Subscription (ex-GST)", rupees(data.amountPaise)],
      ["CGST", rupees(data.cgstPaise)],
      ["SGST", rupees(data.sgstPaise)],
      ["IGST", rupees(data.igstPaise)],
      ["Total", rupees(totalPaise)],
      ["Status", data.paidMethod ? `${data.status} via ${data.paidMethod}` : data.status],
    ];
    if (data.paidAt) {
      rows.push(["Paid on", data.paidAt]);
    }
    for (const [label, value] of rows) {
      doc.fillColor("#64748B").fontSize(10).font("Helvetica");
      doc.text(label, { continued: true });
      doc.fillColor("#0F172A").font("Helvetica-Bold");
      doc.text(`  ${value}`);
      doc.font("Helvetica");
      doc.moveDown(0.35);
    }

    doc.moveDown();
    doc.fillColor("#DC2626").fontSize(14).font("Helvetica-Bold");
    doc.text("TEST INVOICE — not a tax invoice", { align: "center" });

    doc.moveDown();
    doc.fillColor("#64748B").fontSize(8).font("Helvetica");
    doc.text("This is a computer-generated invoice and needs no signature.", { align: "center" });

    doc.end();
  });
}
