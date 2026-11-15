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
  "invoice_status must be paid, open, or overdue (trimmed and lowercased).",
  "Paid invoices require a valid payment_date on/after invoice_date and no later than the business validation date.",
  "Open invoices must have no payment_date and remain open even when due_date has passed.",
  "Overdue invoices must have no payment_date and due_date earlier than the current business validation date.",
  "delay_days and is_late are derived from payment_date for paid invoices; they must be empty for unpaid invoices.",
  "invoice_currency must be USD or CAD for the supplied dataset.",
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
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
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
}

function parseAmount(value: string) {
  const numeric = Number(value);
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
  businessDate = currentDateStamp(),
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
    if (status && !["paid", "open", "overdue"].includes(status)) {
      addIssue(rowNumber, "invoice_status", `"${status}" is not a recognised invoice status (use paid, open, or overdue).`);
    }
    const paymentIsValid = Boolean(paymentDate) && isIsoDate(paymentDate) && isIsoDate(invoiceDate) && compareDates(paymentDate, invoiceDate) >= 0 && paymentDate <= businessDate;
    if (status === "paid" && !paymentIsValid) {
      addIssue(rowNumber, "payment_date", `Paid invoices require a valid payment date between invoice_date and ${businessDate}.`);
    }
    if ((status === "open" || status === "overdue") && paymentDate) {
      addIssue(rowNumber, "payment_date", `${status} invoices must not have a payment date.`);
    }
    if (status === "overdue" && isIsoDate(dueDate) && dueDate >= businessDate) {
      addIssue(rowNumber, "due_date", `Overdue invoices must be due before ${businessDate}.`);
    }

    const delayDays = cell(values, "delay_days");
    if (delayDays && !Number.isFinite(Number(delayDays))) {
      addIssue(rowNumber, "delay_days", `"${delayDays}" is not a number.`);
    }
    const lateFlag = cell(values, "is_late").toLowerCase();
    if (lateFlag && !["0", "1", "0.0", "1.0", "true", "false"].includes(lateFlag)) {
      addIssue(rowNumber, "is_late", `"${lateFlag}" must be boolean or 0/1.`);
    }
    if ((status === "open" || status === "overdue") && delayDays) {
      addIssue(rowNumber, "delay_days", "Unpaid invoices must not supply derived delay_days.");
    }
    if ((status === "open" || status === "overdue") && lateFlag) {
      addIssue(rowNumber, "is_late", "Unpaid invoices must not supply derived is_late.");
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
    validationDate: businessDate,
    validatedAt: new Date().toISOString(),
  };
}

function currentDateStamp() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function unknownColumns(headers: string[]) {
  const known = new Set(KNOWN_COLUMNS);
  return headers.map(normalizeHeader).filter((header) => header && !known.has(header));
}
