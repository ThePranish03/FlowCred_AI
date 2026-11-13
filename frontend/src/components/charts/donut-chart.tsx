import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { formatNumber } from "@/lib/format";

export interface DonutDatum {
  name: string;
  value: number;
  color: string;
}

export function DonutChart({
  data,
  height = 240,
  centerValue,
  centerLabel,
  valueFormatter,
  innerRadius = 62,
  outerRadius = 88,
}: {
  data: DonutDatum[];
  height?: number;
  centerValue?: string;
  centerLabel?: string;
  valueFormatter?: (value: number) => string;
  innerRadius?: number;
  outerRadius?: number;
}) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            paddingAngle={2}
            stroke="#FFFFFF"
            strokeWidth={2}
            isAnimationActive={false}
          >
            {data.map((item) => (
              <Cell key={item.name} fill={item.color} />
            ))}
          </Pie>
          <Tooltip
            content={
              <ChartTooltip
                formatter={(value) => {
                  const numeric = Number(value);
                  const share = total ? ((numeric / total) * 100).toFixed(1) : "0.0";
                  return `${valueFormatter ? valueFormatter(numeric) : formatNumber(numeric)} · ${share}%`;
                }}
              />
            }
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <p className="text-xl font-semibold tracking-tight text-foreground tabular">
          {centerValue ?? formatNumber(total)}
        </p>
        {centerLabel ? (
          <p className="mt-0.5 max-w-[110px] text-center text-[11px] leading-tight text-muted-foreground">
            {centerLabel}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function DonutLegend({ data }: { data: DonutDatum[] }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return (
    <ul className="space-y-2">
      {data.map((item) => (
        <li key={item.name} className="flex items-center justify-between gap-3 text-xs">
          <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="truncate">{item.name}</span>
          </span>
          <span className="shrink-0 font-medium tabular text-foreground">
            {formatNumber(item.value)}
            <span className="ml-1.5 font-normal text-muted-foreground">
              {total ? `${((item.value / total) * 100).toFixed(1)}%` : "0%"}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
