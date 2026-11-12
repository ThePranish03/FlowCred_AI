import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { RiskResponse } from "@/types";
import { ChartTooltip, legendStyle } from "@/components/charts/chart-tooltip";
import { CHART_COLORS } from "@/lib/constants";
import { formatMonthLabel, formatNumber, formatProbability } from "@/lib/format";

export function RiskTrendChart({ data, height = 300 }: { data: RiskResponse["trend"]; height?: number }) {
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
          yAxisId="probability"
          domain={[0, 1]}
          tickFormatter={(value: number) => formatProbability(value, 0)}
          tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
          tickLine={false}
          axisLine={false}
          width={44}
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
                name === "Avg probability" ? formatProbability(Number(value)) : formatNumber(Number(value))
              }
            />
          }
        />
        <Legend wrapperStyle={legendStyle()} iconType="circle" iconSize={7} />
        <ReferenceLine
          yAxisId="probability"
          y={0.45}
          stroke={CHART_COLORS.amber}
          strokeDasharray="4 4"
          label={{ value: "Decision threshold 0.45", position: "insideTopRight", fontSize: 10, fill: CHART_COLORS.amber }}
        />
        <Area
          yAxisId="probability"
          type="monotone"
          dataKey="avgProbability"
          name="Avg probability"
          stroke={CHART_COLORS.accent}
          fill={CHART_COLORS.accent}
          fillOpacity={0.08}
          strokeWidth={2}
        />
        <Bar
          yAxisId="count"
          dataKey="highRisk"
          name="High-risk invoices"
          fill={CHART_COLORS.red}
          fillOpacity={0.35}
          radius={[3, 3, 0, 0]}
          maxBarSize={18}
        />
        <Line
          yAxisId="count"
          type="monotone"
          dataKey="scored"
          name="Scored invoices"
          stroke={CHART_COLORS.navy}
          strokeWidth={1.5}
          strokeDasharray="3 3"
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
