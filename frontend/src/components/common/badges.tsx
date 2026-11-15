import { Badge } from "@/components/ui/badge";
import { RISK_CONFIG, STATUS_CONFIG } from "@/lib/constants";
import type { InvoiceStatus, RiskBand } from "@/types";
import { cn } from "@/lib/utils";

export function RiskBadge({
  band,
  className,
  showRange,
}: {
  band: RiskBand | null | undefined;
  className?: string;
  showRange?: boolean;
}) {
  if (!band) {
    return (
      <Badge variant="muted" className={cn("gap-1.5", className)}>
        Not scored
      </Badge>
    );
  }
  const config = RISK_CONFIG[band];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        config.bg,
        config.text,
        config.border,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", config.dot)} />
      {band}
      {showRange ? <span className="font-normal opacity-70">· {config.range}</span> : null}
    </span>
  );
}

export function StatusBadge({ status, className }: { status: InvoiceStatus; className?: string }) {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        config.bg,
        config.text,
        config.border,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", config.dot)} />
      {config.label}
    </span>
  );
}

export function DelayBadge({
  value,
  className,
  showZero = true,
}: {
  value: number | null | undefined;
  className?: string;
  showZero?: boolean;
}) {
  if (value === null || value === undefined) {
    return <span className={cn("text-xs text-muted-foreground", className)}>—</span>;
  }
  const rounded = Number(value.toFixed(1));
  if (Math.abs(rounded) < 0.5) {
    if (!showZero) return <span className={cn("text-xs text-muted-foreground", className)}>—</span>;
    return (
      <span className={cn("inline-flex items-center gap-1.5 rounded-full border border-risk-low/20 bg-risk-low-soft px-2.5 py-0.5 text-xs font-medium text-risk-low", className)}>
        On time
      </span>
    );
  }
  const isEarly = rounded < 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium tabular",
        isEarly
          ? "border-brand-teal/20 bg-[#E7F6F2] text-brand-teal"
          : "border-risk-high/20 bg-risk-high-soft text-risk-high",
        className,
      )}
    >
      {rounded > 0 ? "+" : ""}
      {rounded} days {isEarly ? "early" : "late"}
    </span>
  );
}
