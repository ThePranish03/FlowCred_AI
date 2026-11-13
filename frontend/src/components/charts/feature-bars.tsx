import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatPercent } from "@/lib/format";

export function FeatureBars({
  items,
  max,
  valueFormatter = (value: number) => formatPercent(value, true, 2),
  barClassName = "bg-brand-accent",
  limit,
}: {
  items: { feature: string; label: string; importance: number }[];
  max?: number;
  valueFormatter?: (value: number) => string;
  barClassName?: string;
  limit?: number;
}) {
  const visible = limit ? items.slice(0, limit) : items;
  const ceiling = max ?? Math.max(...visible.map((item) => item.importance), 0.0001);
  return (
    <ul className="space-y-3">
      {visible.map((item, index) => (
        <li key={item.feature}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-foreground">
              <span className="w-4 shrink-0 text-[10px] font-medium tabular text-muted-foreground">
                {index + 1}
              </span>
              <span className="truncate">{item.label}</span>
            </span>
            <span className="shrink-0 text-xs font-medium tabular text-foreground">
              {valueFormatter(item.importance)}
            </span>
          </div>
          <div className="ml-[22px] h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${barClassName}`}
              style={{ width: `${Math.max((item.importance / ceiling) * 100, 1.5)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ExplainabilityNote({ children }: { children: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="mt-0.5 shrink-0 text-muted-foreground">
            <Info className="h-3.5 w-3.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          Global importance describes the model overall, not a single invoice.
        </TooltipContent>
      </Tooltip>
      <p>{children}</p>
    </div>
  );
}
