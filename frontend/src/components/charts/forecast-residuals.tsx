import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ResidualStep } from "@/types";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { CHART_COLORS } from "@/lib/constants";
import { formatCurrency } from "@/lib/format";

/**
 * Error behaviour by forecast step. The band is the 10th–90th percentile of the
 * signed residual, the line its median, and the bars the mean absolute error.
 * All three are currency amounts, so they share one axis honestly.
 */
export function ForecastResiduals({
  residuals,
  currency,
  height = 260,
}: {
  residuals: ResidualStep[];
  currency: "USD" | "CAD";
  height?: number;
}) {
  const rows = residuals.map((point) => ({
    step: `+${point.step}w`,
    band: [point.p10 ?? 0, point.p90 ?? 0] as [number, number],
    median: point.p50 ?? 0,
    mae: point.mae ?? 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
        <XAxis
          dataKey="step"
          tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
          tickLine={false}
          axisLine={{ stroke: CHART_COLORS.grid }}
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
                typeof value === "number" ? formatCurrency(value, currency, true) : "—"
              }
            />
          }
        />
        <Area
          name="10–90% band"
          dataKey="band"
          stroke="none"
          fill={CHART_COLORS.pale}
          fillOpacity={0.6}
          isAnimationActive={false}
        />
        <Bar
          name="Mean absolute error"
          dataKey="mae"
          fill={CHART_COLORS.accent}
          fillOpacity={0.22}
          radius={[3, 3, 0, 0]}
          barSize={10}
          isAnimationActive={false}
        />
        <Line
          name="Median residual"
          dataKey="median"
          stroke={CHART_COLORS.accent}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
