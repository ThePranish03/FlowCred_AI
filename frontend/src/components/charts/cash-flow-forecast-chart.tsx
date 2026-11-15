import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CashFlowForecastResponse } from "@/types";
import { ChartTooltip, legendStyle } from "@/components/charts/chart-tooltip";
import { CHART_COLORS } from "@/lib/constants";
import { formatCurrency, formatShortDate } from "@/lib/format";

interface Row {
  label: string;
  actual: number | null;
  predicted: number | null;
  band: [number, number] | null;
}

/**
 * Historical collections followed by the weekly forecast path.
 *
 * The shaded area is the empirical backtest interval. Nothing is interpolated:
 * a week either has an observed actual or a forecast, never both.
 */
export function CashFlowForecastChart({
  data,
  currency,
  height = 320,
}: {
  data: CashFlowForecastResponse;
  currency: "USD" | "CAD";
  height?: number;
}) {
  const historyWeeks = data.historical.slice(-26);
  const rows: Row[] = historyWeeks.map((week) => ({
    label: week.weekStart,
    actual: week.actual,
    predicted: null,
    band: null,
  }));

  // Join the last historical point to the first forecast so the line is
  // continuous instead of showing a visual gap.
  if (rows.length && data.weekly.length) {
    rows[rows.length - 1] = {
      ...rows[rows.length - 1],
      predicted: rows[rows.length - 1].actual,
      band: null,
    };
  }

  for (const week of data.weekly) {
    rows.push({
      label: week.weekStart,
      actual: null,
      predicted: week.predicted,
      band: [week.lower, week.upper],
    });
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
        <XAxis
          dataKey="label"
          tickFormatter={(value: string) => formatShortDate(value)}
          tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
          tickLine={false}
          axisLine={{ stroke: CHART_COLORS.grid }}
          minTickGap={28}
        />
        <YAxis
          tickFormatter={(value: number) => formatCurrency(value, currency, true)}
          tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
          tickLine={false}
          axisLine={false}
          width={64}
        />
        <Tooltip
          content={
            <ChartTooltip
              formatter={(value) =>
                typeof value === "number" ? formatCurrency(value, currency) : "—"
              }
            />
          }
        />
        <Legend wrapperStyle={legendStyle()} />
        <Area
          name="Backtest interval"
          dataKey="band"
          stroke="none"
          fill={CHART_COLORS.pale}
          fillOpacity={0.9}
          isAnimationActive={false}
          connectNulls={false}
        />
        <Line
          name="Observed collections"
          dataKey="actual"
          stroke={CHART_COLORS.navy}
          strokeWidth={2}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          name="Weekly forecast"
          dataKey="predicted"
          stroke={CHART_COLORS.accent}
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
