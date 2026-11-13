import {
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
import type { Invoice } from "@/types";
import { ChartTooltip, legendStyle } from "@/components/charts/chart-tooltip";
import { CHART_COLORS } from "@/lib/constants";
import { formatDelayShort, formatNumber, formatShortDate } from "@/lib/format";

export function InvoiceHistoryChart({ invoices, height = 280 }: { invoices: Invoice[]; height?: number }) {
  const data = [...invoices]
    .reverse()
    .map((invoice) => ({
      date: invoice.invoiceDate,
      amount: invoice.amount,
      actualDelay: invoice.delayDays,
      predictedDelay: invoice.predictedDelay,
    }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
        <XAxis
          dataKey="date"
          tickFormatter={(value: string) => formatShortDate(value)}
          tick={{ fontSize: 10, fill: CHART_COLORS.axis }}
          tickLine={false}
          axisLine={{ stroke: CHART_COLORS.grid }}
          minTickGap={20}
        />
        <YAxis
          yAxisId="amount"
          tickFormatter={(value: number) => formatNumber(value, true)}
          tick={{ fontSize: 10, fill: CHART_COLORS.axis }}
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <YAxis
          yAxisId="delay"
          orientation="right"
          tickFormatter={(value: number) => `${value}d`}
          tick={{ fontSize: 10, fill: CHART_COLORS.axis }}
          tickLine={false}
          axisLine={false}
          width={38}
        />
        <Tooltip
          content={
            <ChartTooltip
              labelFormatter={(label) => formatShortDate(String(label))}
              formatter={(value, name) =>
                name === "Invoice amount"
                  ? formatNumber(Number(value))
                  : formatDelayShort(Number(value))
              }
            />
          }
        />
        <Legend wrapperStyle={legendStyle()} iconType="circle" iconSize={7} />
        <ReferenceLine yAxisId="delay" y={0} stroke={CHART_COLORS.axis} strokeOpacity={0.4} />
        <Bar
          yAxisId="amount"
          dataKey="amount"
          name="Invoice amount"
          fill={CHART_COLORS.pale}
          radius={[3, 3, 0, 0]}
          maxBarSize={22}
        />
        <Line
          yAxisId="delay"
          type="monotone"
          dataKey="actualDelay"
          name="Actual delay"
          stroke={CHART_COLORS.amber}
          strokeWidth={1.8}
          dot={{ r: 2 }}
          connectNulls
        />
        <Line
          yAxisId="delay"
          type="monotone"
          dataKey="predictedDelay"
          name="Predicted delay"
          stroke={CHART_COLORS.accent}
          strokeWidth={1.8}
          strokeDasharray="4 3"
          dot={false}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
