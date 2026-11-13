export interface CsvColumn<T> {
  key: keyof T & string;
  label: string;
  format?: (value: T[keyof T], row: T) => string | number;
}

function escapeCell(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv<T extends Record<string, unknown>>(rows: T[], columns: CsvColumn<T>[]) {
  const header = columns.map((column) => escapeCell(column.label)).join(",");
  const body = rows.map((row) =>
    columns
      .map((column) => {
        const raw = row[column.key];
        const value = column.format ? column.format(raw, row) : raw;
        return escapeCell(value);
      })
      .join(","),
  );
  return [header, ...body].join("\r\n");
}

export function downloadCsv<T extends Record<string, unknown>>(
  filename: string,
  rows: T[],
  columns: CsvColumn<T>[],
) {
  const csv = "\uFEFF" + toCsv(rows, columns);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
