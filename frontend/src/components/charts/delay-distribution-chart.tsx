import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DistributionBucket } from "@/types";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { CHART_COLORS } from "@/lib/constants";
import { formatNumber } from "@/lib/format";

function bucketColor(bucket: string) {
  if (bucket.includes("early")) return CHART_COLORS.teal;
  if (bucket.toLowerCase().includes("on time")) return "#15803D";
  return CHART_COLORS.red;
}

function shortBucket(bucket: string) {
  return bucket
    .replace(" days early", " early")
    .replace(" days late", " late")
    .replace("On time (0)", "On time");
}

export function DelayDistributionChart({ data, height = 280 }: { data: DistributionBucket[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
        <XAxis
          dataKey="bucket"
          tickFormatter={shortBucket}
          tick={{ fontSize: 10, fill: CHART_COLORS.axis }}
          tickLine={false}
          axisLine={{ stroke: CHART_COLORS.grid }}
          interval={0}
        />
        <YAxis
          tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
          tickLine={false}
          axisLine={false}
          width={44}
        />
        <Tooltip
          cursor={{ fill: "#F1F5FB" }}
          content={<ChartTooltip formatter={(value) => formatNumber(Number(value))} />}
        />
        <Bar dataKey="count" name="Invoices" radius={[4, 4, 0, 0]} maxBarSize={44}>
          {data.map((entry) => (
            <Cell key={entry.bucket} fill={bucketColor(entry.bucket)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
