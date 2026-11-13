import type { UploadValidationResult } from "@/types";

export const REQUIRED_INVOICE_COLUMNS = [
  "invoice_id",
  "customer_id",
  "name_customer",
  "invoice_amount",
  "invoice_date",
  "due_date",
  "invoice_currency",
  "cust_payment_terms",
  "invoice_status",
];

export const OPTIONAL_INVOICE_COLUMNS = [
  "payment_date",
  "delay_days",
  "is_late",
  "business_code",
  "doc_id",
  "document_create_date",
  "posting_id",
];

export const KNOWN_COLUMNS = [...REQUIRED_INVOICE_COLUMNS, ...OPTIONAL_INVOICE_COLUMNS];

export const VALIDATION_RULES = [
  "invoice_id must be present and unique across the file.",
  "customer_id must be present for every row.",
  "invoice_amount must be a positive number.",
  "invoice_date and due_date must be valid ISO dates (YYYY-MM-DD).",
  "due_date must not be earlier than invoice_date.",
  "payment_date, when supplied, must be a valid ISO date and not earlier than invoice_date.",
  "delay_days and is_late are accepted but recomputed by the backend pipeline.",
  "invoice_currency must be USD or CAD for the supplied dataset.",
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/;
const CURRENCIES = new Set(["USD", "CAD"]);
const MAX_ISSUES = 250;

interface ParsedRow {
  rowNumber: number;
  values: Record<string, string>;
}

function normalizeHeader(header: string) {
  return header.trim().toLowerCase().replace(/\s+/g, "_");
}

function cell(values: Record<string, string>, column: string) {
  const value = values[column];
  return value === undefined || value === null ? "" : String(value).trim();
}

function isIsoDate(value: string) {
  if (!ISO_DATE.test(value)) return false;
  return !Number.isNaN(new Date(value.slice(0, 10)).getTime());
}

function parseAmount(value: string) {
  const numeric = Number(value.replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function compareDates(a: string, b: string) {
  return a.slice(0, 10).localeCompare(b.slice(0, 10));
}

export function validateInvoiceCsv(
  fileName: string,
  sizeKb: number,
  rawHeaders: string[],
  rawRows: Record<string, string>[],
): UploadValidationResult {
  const headerMap = new Map<string, string>();
  rawHeaders.forEach((header) => headerMap.set(normalizeHeader(header), header));
  const headers = rawHeaders.map((header) => header.trim()).filter(Boolean);

  const parsedRows: ParsedRow[] = rawRows
    .map((row, index) => {
      const values: Record<string, string> = {};
      Object.entries(row).forEach(([key, value]) => {
        values[normalizeHeader(key)] = value === null || value === undefined ? "" : String(value);
      });
      return { rowNumber: index + 2, values };
    })
    .filter((row) => Object.values(row.values).some((value) => value.trim() !== ""));

  const issues: UploadValidationResult["issues"] = [];
  const invalidRows = new Set<number>();
  const seenIds = new Set<string>();
  let duplicateRows = 0;

  const missingColumns = REQUIRED_INVOICE_COLUMNS.filter((column) => !headerMap.has(column));
  if (missingColumns.length) {
    issues.push({
      row: 0,
      column: missingColumns.join(", "),
      message: `Missing required column${missingColumns.length === 1 ? "" : "s"}: ${missingColumns.join(", ")}.`,
    });
  }

  const addIssue = (row: number, column: string, message: string) => {
    invalidRows.add(row);
    if (issues.length < MAX_ISSUES) issues.push({ row, column, message });
  };

  for (const { rowNumber, values } of parsedRows) {
    for (const column of REQUIRED_INVOICE_COLUMNS) {
      if (!cell(values, column)) addIssue(rowNumber, column, "Required value is missing.");
    }

    const invoiceId = cell(values, "invoice_id");
    if (invoiceId) {
      if (seenIds.has(invoiceId)) {
        duplicateRows += 1;
        addIssue(rowNumber, "invoice_id", `Duplicate invoice_id "${invoiceId}".`);
      } else {
        seenIds.add(invoiceId);
      }
    }

    const amount = cell(values, "invoice_amount");
    if (amount) {
      const parsed = parseAmount(amount);
      if (parsed === null) addIssue(rowNumber, "invoice_amount", `"${amount}" is not a number.`);
      else if (parsed <= 0) addIssue(rowNumber, "invoice_amount", "Amount must be greater than zero.");
    }

    const invoiceDate = cell(values, "invoice_date");
    const dueDate = cell(values, "due_date");
    if (invoiceDate && !isIsoDate(invoiceDate)) {
      addIssue(rowNumber, "invoice_date", `"${invoiceDate}" is not a valid ISO date.`);
    }
    if (dueDate && !isIsoDate(dueDate)) {
      addIssue(rowNumber, "due_date", `"${dueDate}" is not a valid ISO date.`);
    }
    if (isIsoDate(invoiceDate) && isIsoDate(dueDate) && compareDates(dueDate, invoiceDate) < 0) {
      addIssue(rowNumber, "due_date", "Due date is earlier than the invoice date.");
    }

    const paymentDate = cell(values, "payment_date");
    if (paymentDate) {
      if (!isIsoDate(paymentDate)) {
        addIssue(rowNumber, "payment_date", `"${paymentDate}" is not a valid ISO date.`);
      } else if (isIsoDate(invoiceDate) && compareDates(paymentDate, invoiceDate) < 0) {
        addIssue(rowNumber, "payment_date", "Payment date is earlier than the invoice date.");
      }
    }

    const currency = cell(values, "invoice_currency").toUpperCase();
    if (currency && !CURRENCIES.has(currency)) {
      addIssue(rowNumber, "invoice_currency", `Unsupported currency "${currency}" (expected USD or CAD).`);
    }

    const status = cell(values, "invoice_status").toLowerCase();
    if (status && !["paid", "open"].includes(status)) {
      addIssue(rowNumber, "invoice_status", `"${status}" is not a recognised invoice status.`);
    }
  }

  const missingValues = KNOWN_COLUMNS.map((column) => ({
    column,
    missing: headerMap.has(column)
      ? parsedRows.filter((row) => !cell(row.values, column)).length
      : parsedRows.length,
  })).filter((entry) => entry.missing > 0);

  const preview = rawRows
    .filter((row) => Object.values(row).some((value) => String(value ?? "").trim() !== ""))
    .slice(0, 5)
    .map((row) => {
      const record: Record<string, string> = {};
      headers.forEach((header) => {
        record[header] = String(row[header] ?? "");
      });
      return record;
    });

  return {
    fileName,
    sizeKb,
    totalRows: parsedRows.length,
    validRows: parsedRows.length - invalidRows.size,
    invalidRows: invalidRows.size,
    duplicateRows,
    missingValues,
    issues,
    headers,
    preview,
    validatedAt: new Date().toISOString(),
  };
}

export function unknownColumns(headers: string[]) {
  const known = new Set(KNOWN_COLUMNS);
  return headers.map(normalizeHeader).filter((header) => header && !known.has(header));
}
