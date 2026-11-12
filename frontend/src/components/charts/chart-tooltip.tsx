import { cn } from "@/lib/utils";

interface TooltipItem {
  name?: string | number;
  value?: string | number;
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipItem[];
  label?: string | number;
  formatter?: (value: string | number, name: string, item: TooltipItem) => string;
  labelFormatter?: (label: string | number) => string;
  className?: string;
}

export function ChartTooltip({
  active,
  payload,
  label,
  formatter,
  labelFormatter,
  className,
}: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-popover",
        className,
      )}
    >
      {label !== undefined ? (
        <p className="mb-1.5 font-semibold text-foreground">
          {labelFormatter ? labelFormatter(label) : label}
        </p>
      ) : null}
      <div className="space-y-1">
        {payload.map((item, index) => (
          <div key={`${item.dataKey}-${index}`} className="flex items-center justify-between gap-5">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: item.color ?? "#2675D8" }}
              />
              {item.name}
            </span>
            <span className="font-medium tabular text-foreground">
              {formatter && item.value !== undefined
                ? formatter(item.value, String(item.name ?? ""), item)
                : typeof item.value === "number"
                  ? item.value.toLocaleString("en-US", { maximumFractionDigits: 2 })
                  : item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function legendStyle() {
  return { fontSize: 12, color: "#475467" };
}
