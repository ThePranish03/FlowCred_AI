import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

interface PdfOptions {
  filename: string;
  title: string;
  subtitle?: string;
  summary?: { label: string; value: string }[];
  columns: string[];
  rows: (string | number)[][];
  notes?: string[];
}

export function downloadPdf({
  filename,
  title,
  subtitle,
  summary = [],
  columns,
  rows,
  notes = [],
}: PdfOptions) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.setFillColor(18, 59, 103);
  doc.rect(0, 0, pageWidth, 64, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(title, 40, 30);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(subtitle ?? "FlowCred AI · Explainable Accounts Receivable Intelligence", 40, 48);
  doc.text(`Generated ${new Date().toLocaleString("en-GB")}`, pageWidth - 40, 48, { align: "right" });

  let cursor = 84;
  if (summary.length) {
    doc.setTextColor(23, 36, 58);
    doc.setFontSize(9);
    const gap = (pageWidth - 80) / summary.length;
    summary.forEach((item, index) => {
      const x = 40 + index * gap;
      doc.setTextColor(102, 112, 133);
      doc.text(item.label, x, cursor);
      doc.setTextColor(23, 36, 58);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(item.value, x, cursor + 16);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
    });
    cursor += 34;
  }

  autoTable(doc, {
    startY: cursor,
    head: [columns],
    body: rows.length ? rows : [["No records returned by the API", ...columns.slice(1).map(() => "")]],
    styles: {
      font: "helvetica",
      fontSize: 7.5,
      cellPadding: 4,
      textColor: [38, 52, 74],
      lineColor: [228, 233, 242],
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: [232, 238, 247],
      textColor: [18, 59, 103],
      fontStyle: "bold",
      fontSize: 7.5,
    },
    alternateRowStyles: { fillColor: [248, 250, 253] },
    margin: { left: 40, right: 40, bottom: 54 },
    didDrawPage: () => {
      doc.setDrawColor(228, 233, 242);
      doc.line(40, pageHeight - 40, pageWidth - 40, pageHeight - 40);
      doc.setFontSize(7.5);
      doc.setTextColor(102, 112, 133);
      doc.text("FlowCred AI · Demo report generated from recorded model artifacts", 40, pageHeight - 26);
      doc.text(
        `Page ${doc.getNumberOfPages()}`,
        pageWidth - 40,
        pageHeight - 26,
        { align: "right" },
      );
    },
  });

  if (notes.length) {
    const finalY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursor;
    let noteY = finalY + 20;
    if (noteY > pageHeight - 70) {
      doc.addPage();
      noteY = 60;
    }
    doc.setFontSize(7.5);
    doc.setTextColor(102, 112, 133);
    notes.forEach((note) => {
      const lines = doc.splitTextToSize(`• ${note}`, pageWidth - 80);
      doc.text(lines, 40, noteY);
      noteY += lines.length * 10 + 2;
    });
  }

  doc.save(filename);
}
