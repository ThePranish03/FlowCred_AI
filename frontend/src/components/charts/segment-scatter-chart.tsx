import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { SegmentsResponse } from "@/types";
import { CHART_COLORS, CLUSTER_COLORS } from "@/lib/constants";

type Point = SegmentsResponse["pca"]["points"][number];

function PointTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload?: Point }[];
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-popover">
      <p className="font-semibold text-foreground">{point.customerId}</p>
      <p className="mt-1 text-muted-foreground">
        Cluster {point.clusterId} · PC1 {point.x.toFixed(2)} · PC2 {point.y.toFixed(2)}
      </p>
    </div>
  );
}

export function SegmentScatterChart({
  pca,
  height = 420,
  visibleClusters,
}: {
  pca: SegmentsResponse["pca"];
  height?: number;
  visibleClusters?: number[];
}) {
  const clusters = Array.from(new Set(pca.points.map((point) => point.clusterId))).sort((a, b) => a - b);
  const shown = visibleClusters?.length ? clusters.filter((id) => visibleClusters.includes(id)) : clusters;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 10, right: 16, bottom: 24, left: 0 }}>
        <CartesianGrid stroke={CHART_COLORS.grid} />
        <XAxis
          type="number"
          dataKey="x"
          name="PC1"
          domain={[pca.xRange.p01, pca.xRange.p99]}
          tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
          tickLine={false}
          axisLine={{ stroke: CHART_COLORS.grid }}
          tickFormatter={(value: number) => value.toFixed(0)}
          label={{ value: `PC1 (${(pca.explainedVariance[0] * 100).toFixed(1)}% variance)`, position: "insideBottom", offset: -12, fontSize: 10, fill: CHART_COLORS.axis }}
        />
        <YAxis
          type="number"
          dataKey="y"
          name="PC2"
          domain={[pca.yRange.p01, pca.yRange.p99]}
          tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
          tickLine={false}
          axisLine={false}
          width={46}
          tickFormatter={(value: number) => value.toFixed(0)}
          label={{ value: `PC2 (${(pca.explainedVariance[1] * 100).toFixed(1)}%)`, angle: -90, position: "insideLeft", offset: 16, fontSize: 10, fill: CHART_COLORS.axis }}
        />
        <ZAxis range={[26, 26]} />
        <Tooltip cursor={{ strokeDasharray: "3 3", stroke: CHART_COLORS.axis }} content={<PointTooltip />} />
        {shown.map((clusterId, index) => (
          <Scatter
            key={clusterId}
            name={`Cluster ${clusterId}`}
            data={pca.points.filter((point) => point.clusterId === clusterId)}
            fill={CLUSTER_COLORS[clusterId % CLUSTER_COLORS.length]}
            fillOpacity={0.6}
            isAnimationActive={false}
          />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );
}
