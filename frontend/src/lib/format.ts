const currencyFormatters = new Map<string, Intl.NumberFormat>();
const numberFormatters = new Map<string, Intl.NumberFormat>();

function currencyFormatter(currency: string, compact: boolean) {
  const key = `${currency}-${compact}`;
  if (!currencyFormatters.has(key)) {
    currencyFormatters.set(
      key,
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        notation: compact ? "compact" : "standard",
        maximumFractionDigits: compact ? 1 : 2,
        minimumFractionDigits: compact ? 0 : 2,
      }),
    );
  }
  return currencyFormatters.get(key)!;
}

export function formatCurrency(value: number | null | undefined, currency = "USD", compact = false) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return currencyFormatter(currency, compact).format(value);
}

export function formatNumber(value: number | null | undefined, compact = false) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const key = compact ? "compact" : "standard";
  if (!numberFormatters.has(key)) {
    numberFormatters.set(
      key,
      new Intl.NumberFormat("en-US", {
        notation: compact ? "compact" : "standard",
        maximumFractionDigits: compact ? 1 : 0,
      }),
    );
  }
  return numberFormatters.get(key)!.format(value);
}

export function formatPercent(value: number | null | undefined, fraction = false, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const percent = fraction ? value * 100 : value;
  return `${percent.toFixed(digits)}%`;
}

export function formatProbability(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatSignedDays(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const rounded = Number(value.toFixed(digits));
  if (Math.abs(rounded) < 0.5) return "On time";
  const magnitude = Math.abs(rounded);
  return rounded < 0 ? `${magnitude} ${magnitude === 1 ? "day" : "days"} early` : `${magnitude} ${magnitude === 1 ? "day" : "days"} late`;
}

export function formatDelayShort(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const rounded = Number(value.toFixed(digits));
  if (Math.abs(rounded) < 0.5) return "0d";
  return `${rounded > 0 ? "+" : ""}${rounded}d`;
}

export function delayDirection(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "unknown";
  if (Math.abs(value) < 0.5) return "on_time";
  return value < 0 ? "early" : "late";
}

export function formatDate(value: string | Date | null | undefined, fallback = "—") {
  if (!value) return fallback;
  const date = typeof value === "string" ? new Date(`${value.slice(0, 10)}T00:00:00`) : value;
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatShortDate(value: string | Date | null | undefined, fallback = "—") {
  if (!value) return fallback;
  const date = typeof value === "string" ? new Date(`${value.slice(0, 10)}T00:00:00`) : value;
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(date);
}

export function formatDateTime(value: string | Date | null | undefined, fallback = "—") {
  if (!value) return fallback;
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatMonthLabel(value: string) {
  if (!value) return "—";
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }).format(
    new Date(year, month - 1, 1),
  );
}

export function daysBetween(from: string, to: string) {
  const start = new Date(`${from.slice(0, 10)}T00:00:00`).getTime();
  const end = new Date(`${to.slice(0, 10)}T00:00:00`).getTime();
  return Math.round((end - start) / 86_400_000);
}

export function riskFromProbability(probability: number | null | undefined) {
  if (probability === null || probability === undefined) return null;
  if (probability < 0.3) return "Low" as const;
  if (probability < 0.7) return "Medium" as const;
  return "High" as const;
}

export function titleCase(value: string) {
  return value
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function truncate(value: string, length = 48) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}
