import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MonthlyTrend } from "@/types";
import { ChartTooltip, legendStyle } from "@/components/charts/chart-tooltip";
import { CHART_COLORS } from "@/lib/constants";
import { formatMonthLabel, formatNumber } from "@/lib/format";

export function MonthlyTrendChart({ data, height = 300 }: { data: MonthlyTrend[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
        <XAxis
          dataKey="monthKey"
          tickFormatter={formatMonthLabel}
          tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
          tickLine={false}
          axisLine={{ stroke: CHART_COLORS.grid }}
          minTickGap={24}
        />
        <YAxis
          yAxisId="amount"
          tickFormatter={(value: number) => formatNumber(value, true)}
          tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
          tickLine={false}
          axisLine={false}
          width={54}
        />
        <YAxis
          yAxisId="count"
          orientation="right"
          tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
          tickLine={false}
          axisLine={false}
          width={40}
        />
        <Tooltip
          content={
            <ChartTooltip
              labelFormatter={(label) => formatMonthLabel(String(label))}
              formatter={(value, name) =>
                name === "Invoice value" ? formatNumber(Number(value), true) : formatNumber(Number(value))
              }
            />
          }
        />
        <Legend wrapperStyle={legendStyle()} iconType="circle" iconSize={7} />
        <Bar
          yAxisId="amount"
          dataKey="amount"
          name="Invoice value"
          fill={CHART_COLORS.pale}
          radius={[4, 4, 0, 0]}
          maxBarSize={26}
        />
        <Line
          yAxisId="count"
          type="monotone"
          dataKey="invoices"
          name="Invoices"
          stroke={CHART_COLORS.accent}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
