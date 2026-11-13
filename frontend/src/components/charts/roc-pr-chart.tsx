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
import { ChartTooltip, legendStyle } from "@/components/charts/chart-tooltip";
import { CHART_COLORS } from "@/lib/constants";

const tick = { fontSize: 11, fill: CHART_COLORS.axis };

export function RocCurveChart({
  data,
  auc,
  height = 280,
}: {
  data: { x: number; y: number }[];
  auc: number;
  height?: number;
}) {
  const series = data.map((point) => ({ ...point, chance: point.x }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={series} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid stroke={CHART_COLORS.grid} />
        <XAxis
          dataKey="x"
          type="number"
          domain={[0, 1]}
          tickFormatter={(value: number) => value.toFixed(1)}
          tick={tick}
          tickLine={false}
          axisLine={{ stroke: CHART_COLORS.grid }}
          label={{ value: "False positive rate", position: "insideBottom", offset: -2, fontSize: 10, fill: CHART_COLORS.axis }}
        />
        <YAxis
          type="number"
          domain={[0, 1]}
          tickFormatter={(value: number) => value.toFixed(1)}
          tick={tick}
          tickLine={false}
          axisLine={false}
          width={34}
        />
        <Tooltip
          content={
            <ChartTooltip
              labelFormatter={(label) => `FPR ${Number(label).toFixed(3)}`}
              formatter={(value, name) =>
                `${name} ${Number(value).toFixed(3)}`
              }
            />
          }
        />
        <Legend wrapperStyle={legendStyle()} iconType="plainline" iconSize={14} />
        <Line
          type="monotone"
          dataKey="chance"
          name="Chance"
          stroke={CHART_COLORS.slate}
          strokeDasharray="4 4"
          strokeWidth={1}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="y"
          name={`XGBoost (AUC ${auc.toFixed(3)})`}
          stroke={CHART_COLORS.accent}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function PrecisionRecallChart({
  data,
  prAuc,
  height = 280,
}: {
  data: { x: number; y: number }[];
  prAuc: number;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid stroke={CHART_COLORS.grid} />
        <XAxis
          dataKey="x"
          type="number"
          domain={[0, 1]}
          tickFormatter={(value: number) => value.toFixed(1)}
          tick={tick}
          tickLine={false}
          axisLine={{ stroke: CHART_COLORS.grid }}
          label={{ value: "Recall", position: "insideBottom", offset: -2, fontSize: 10, fill: CHART_COLORS.axis }}
        />
        <YAxis
          type="number"
          domain={[0, 1]}
          tickFormatter={(value: number) => value.toFixed(1)}
          tick={tick}
          tickLine={false}
          axisLine={false}
          width={34}
        />
        <Tooltip
          content={
            <ChartTooltip
              labelFormatter={(label) => `Recall ${Number(label).toFixed(3)}`}
              formatter={(value, name) => `${name} ${Number(value).toFixed(3)}`}
            />
          }
        />
        <Legend wrapperStyle={legendStyle()} iconType="plainline" iconSize={14} />
        <Line
          type="monotone"
          dataKey="y"
          name={`XGBoost (PR-AUC ${prAuc.toFixed(3)})`}
          stroke={CHART_COLORS.teal}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
