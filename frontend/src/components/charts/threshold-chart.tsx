import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { LatePaymentModelMetrics } from "@/types";
import { ChartTooltip, legendStyle } from "@/components/charts/chart-tooltip";
import { CHART_COLORS } from "@/lib/constants";

export function ThresholdChart({
  data,
  decisionThreshold,
  height = 280,
}: {
  data: LatePaymentModelMetrics["thresholdAnalysis"];
  decisionThreshold: number;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid stroke={CHART_COLORS.grid} />
        <XAxis
          dataKey="threshold"
          type="number"
          domain={[0, 1]}
          tickFormatter={(value: number) => value.toFixed(2)}
          tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
          tickLine={false}
          axisLine={{ stroke: CHART_COLORS.grid }}
          label={{ value: "Probability threshold", position: "insideBottom", offset: -2, fontSize: 10, fill: CHART_COLORS.axis }}
        />
        <YAxis
          domain={[0, 1]}
          tickFormatter={(value: number) => value.toFixed(1)}
          tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
          tickLine={false}
          axisLine={false}
          width={34}
        />
        <Tooltip
          content={
            <ChartTooltip
              labelFormatter={(label) => `Threshold ${Number(label).toFixed(2)}`}
              formatter={(value, name) => `${name} ${Number(value).toFixed(3)}`}
            />
          }
        />
        <Legend wrapperStyle={legendStyle()} iconType="plainline" iconSize={14} />
        <ReferenceLine
          x={decisionThreshold}
          stroke={CHART_COLORS.amber}
          strokeDasharray="4 4"
          label={{ value: "0.45", position: "top", fontSize: 10, fill: CHART_COLORS.amber }}
        />
        <Line type="monotone" dataKey="precision" name="Precision" stroke={CHART_COLORS.navy} strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="recall" name="Recall" stroke={CHART_COLORS.teal} strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="f1" name="F1" stroke={CHART_COLORS.accent} strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="accuracy" name="Accuracy" stroke={CHART_COLORS.slate} strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
