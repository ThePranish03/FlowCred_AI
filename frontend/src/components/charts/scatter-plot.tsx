import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { CHART_COLORS } from "@/lib/constants";

export function ScatterPlot({
  data,
  xKey,
  yKey,
  xLabel,
  yLabel,
  height = 320,
  color = CHART_COLORS.accent,
  diagonal = false,
  formatter,
}: {
  data: Record<string, number>[];
  xKey: string;
  yKey: string;
  xLabel: string;
  yLabel: string;
  height?: number;
  color?: string;
  diagonal?: boolean;
  formatter?: (value: number) => string;
}) {
  const values = data.flatMap((row) => [row[xKey], row[yKey]]).filter(Number.isFinite);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const pad = (max - min) * 0.06 || 1;
  const domain: [number, number] = [Math.floor(min - pad), Math.ceil(max + pad)];

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 10, right: 14, bottom: 16, left: 0 }}>
        <CartesianGrid stroke={CHART_COLORS.grid} />
        <XAxis
          type="number"
          dataKey={xKey}
          name={xLabel}
          domain={domain}
          tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
          tickLine={false}
          axisLine={{ stroke: CHART_COLORS.grid }}
          label={{ value: xLabel, position: "insideBottom", offset: -8, fontSize: 10, fill: CHART_COLORS.axis }}
        />
        <YAxis
          type="number"
          dataKey={yKey}
          name={yLabel}
          domain={domain}
          tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
          tickLine={false}
          axisLine={false}
          width={42}
          label={{ value: yLabel, angle: -90, position: "insideLeft", offset: 14, fontSize: 10, fill: CHART_COLORS.axis }}
        />
        <ZAxis range={[14, 14]} />
        <Tooltip
          cursor={{ strokeDasharray: "3 3", stroke: CHART_COLORS.axis }}
          content={
            <ChartTooltip
              formatter={(value, name) =>
                formatter ? formatter(Number(value)) : Number(value).toFixed(2)
              }
            />
          }
        />
        {diagonal ? (
          <ReferenceLine
            segment={[
              { x: domain[0], y: domain[0] },
              { x: domain[1], y: domain[1] },
            ]}
            stroke={CHART_COLORS.slate}
            strokeDasharray="4 4"
          />
        ) : null}
        <Scatter data={data} fill={color} fillOpacity={0.55} isAnimationActive={false} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
