import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PerOriginPoint } from "@/types";
import { ChartTooltip, legendStyle } from "@/components/charts/chart-tooltip";
import { CHART_COLORS } from "@/lib/constants";
import { formatShortDate } from "@/lib/format";

const TRACKED = [
  { model: "xgboost_daily", label: "Selected model", color: CHART_COLORS.accent, width: 2 },
  { model: "seasonal_naive", label: "Seasonal-naive", color: CHART_COLORS.slate, width: 1.5 },
  { model: "due_date_schedule", label: "Due-date schedule", color: CHART_COLORS.teal, width: 1.5 },
];

/**
 * WAPE at each validation origin. Flat lines mean the model is stable rather
 * than lucky on average; spikes show where the regime moved.
 */
export function ForecastStability({
  perOrigin,
  height = 260,
}: {
  perOrigin: Record<string, PerOriginPoint[]>;
  height?: number;
}) {
  const base = perOrigin[TRACKED[0].model] ?? [];
  const rows = base.map((point) => {
    const row: Record<string, number | string> = { asOf: point.asOf, origin: point.origin };
    for (const track of TRACKED) {
      const match = perOrigin[track.model]?.find((p) => p.origin === point.origin);
      if (match?.wape != null) row[track.model] = Number((match.wape * 100).toFixed(2));
    }
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
        <XAxis
          dataKey="asOf"
          tickFormatter={(value: string) => formatShortDate(value)}
          tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
          tickLine={false}
          axisLine={{ stroke: CHART_COLORS.grid }}
          minTickGap={40}
        />
        <YAxis
          tickFormatter={(value: number) => `${value}%`}
          tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <Tooltip
          content={
            <ChartTooltip
              formatter={(value) => (typeof value === "number" ? `${value.toFixed(1)}%` : "—")}
              labelFormatter={(label) => formatShortDate(String(label))}
            />
          }
        />
        <ReferenceLine
          y={10}
          stroke={CHART_COLORS.grid}
          strokeDasharray="4 4"
          label={{ value: "10%", position: "insideTopRight", fontSize: 10, fill: CHART_COLORS.axis }}
        />
        {TRACKED.map((track) => (
          <Line
            key={track.model}
            name={track.label}
            dataKey={track.model}
            stroke={track.color}
            strokeWidth={track.width}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export { legendStyle };
