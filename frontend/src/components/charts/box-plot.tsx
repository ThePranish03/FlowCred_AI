import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatNumber } from "@/lib/format";

export interface BoxDatum {
  label: string;
  color: string;
  min: number | null;
  q1: number | null;
  median: number | null;
  q3: number | null;
  max: number | null;
  count?: number | null;
}

export function BoxPlot({
  rows,
  valueFormatter = (value: number) => formatNumber(value, true),
}: {
  rows: BoxDatum[];
  valueFormatter?: (value: number) => string;
}) {
  const values = rows.flatMap((row) => [row.min, row.max]).filter((value): value is number => value != null && Number.isFinite(value));
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const span = max - min || 1;
  const pct = (value: number) => Math.min(98, Math.max(2, ((value - min) / span) * 100));

  return (
    <div className="space-y-1">
      {rows.map((row) => {
        const hasValues = [row.min, row.q1, row.median, row.q3, row.max].every((value) => value != null);
        return (
          <div key={row.label} className="grid grid-cols-[112px_1fr] items-center gap-3">
            <span className="truncate text-[11px] text-muted-foreground" title={row.label}>
              {row.label}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="relative h-7 w-full cursor-default">
                  <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-border" />
                  {hasValues ? (
                    <>
                      <div
                        className="absolute top-1/2 h-px -translate-y-1/2"
                        style={{
                          left: `${pct(row.min!)}%`,
                          width: `${Math.max(pct(row.max!) - pct(row.min!), 0.5)}%`,
                          backgroundColor: row.color,
                          opacity: 0.6,
                        }}
                      />
                      <div
                        className="absolute top-1/2 h-4 -translate-y-1/2 rounded-sm border"
                        style={{
                          left: `${pct(row.q1!)}%`,
                          width: `${Math.max(pct(row.q3!) - pct(row.q1!), 0.8)}%`,
                          borderColor: row.color,
                          backgroundColor: `${row.color}26`,
                        }}
                      />
                      <div
                        className="absolute top-1/2 h-4 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full"
                        style={{ left: `${pct(row.median!)}%`, backgroundColor: row.color }}
                      />
                    </>
                  ) : (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                      No data
                    </span>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <p className="font-medium">{row.label}</p>
                {hasValues ? (
                  <p className="mt-1 tabular text-muted-foreground">
                    min {valueFormatter(row.min!)} · Q1 {valueFormatter(row.q1!)} · median {valueFormatter(row.median!)} ·
                    Q3 {valueFormatter(row.q3!)} · max {valueFormatter(row.max!)}
                    {row.count != null ? ` · n=${formatNumber(row.count)}` : ""}
                  </p>
                ) : (
                  <p className="mt-1 text-muted-foreground">No observations in this cluster.</p>
                )}
              </TooltipContent>
            </Tooltip>
          </div>
        );
      })}
      <div className="ml-[124px] flex justify-between pt-1 text-[10px] text-muted-foreground">
        <span className="tabular">{valueFormatter(min)}</span>
        <span className="tabular">{valueFormatter((min + max) / 2)}</span>
        <span className="tabular">{valueFormatter(max)}</span>
      </div>
    </div>
  );
}
