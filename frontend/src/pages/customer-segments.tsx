import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowUpRight, Boxes, Layers3, Target, Users } from "lucide-react";
import { useSegments } from "@/api/queries";
import { PageHeader } from "@/components/common/page-header";
import { KpiCard } from "@/components/common/kpi-card";
import { ChartCard } from "@/components/common/chart-card";
import { InfoNote } from "@/components/common/notes";
import { ErrorState } from "@/components/common/states";
import { PageSkeleton } from "@/components/common/loading";
import { SegmentScatterChart } from "@/components/charts/segment-scatter-chart";
import { BoxPlot } from "@/components/charts/box-plot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { CLUSTER_COLORS } from "@/lib/constants";
import {
  formatDelayShort,
  formatNumber,
  formatPercent,
} from "@/lib/format";

export default function CustomerSegmentsPage() {
  const { data, isLoading, isError, error, refetch } = useSegments();
  const [searchParams] = useSearchParams();
  const [visibleClusters, setVisibleClusters] = useState<number[]>([]);
  const [featureIndex, setFeatureIndex] = useState(0);

  useEffect(() => {
    const cluster = searchParams.get("cluster");
    if (cluster != null && !Number.isNaN(Number(cluster))) {
      setVisibleClusters([Number(cluster)]);
    }
  }, [searchParams]);

  const heatmapMax = useMemo(() => {
    if (!data) return 1;
    return Math.max(...data.heatmap.flatMap((row) => row.values.map((value) => Math.abs(value))), 0.5);
  }, [data]);

  if (isLoading) return <PageSkeleton />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Segment data could not be loaded"
        description={error instanceof Error ? error.message : "The segmentation endpoint did not respond."}
        onRetry={() => refetch()}
      />
    );
  }

  const { model, sizes, pca, heatmap, featureComparison, stability, modelComparison, warnings } = data;
  const selectedFeature = featureComparison[featureIndex];
  const activeClusters = visibleClusters.length ? visibleClusters : sizes.map((size) => size.clusterId);

  function toggleCluster(clusterId: number) {
    setVisibleClusters((current) => {
      const base = current.length ? current : sizes.map((size) => size.clusterId);
      const next = base.includes(clusterId) ? base.filter((id) => id !== clusterId) : [...base, clusterId];
      return next.length ? next : base;
    });
  }

  function boxFormatter(feature: string) {
    if (feature === "avg_payment_delay") return (value: number) => formatDelayShort(value);
    if (feature === "late_payment_ratio" || feature === "recent_late_ratio") {
      return (value: number) => formatPercent(value, true);
    }
    if (feature === "avg_invoice_amount") return (value: number) => formatNumber(value, true);
    if (feature === "invoice_frequency") return (value: number) => value.toFixed(2);
    return (value: number) => formatNumber(value);
  }

  const comparisonRows: Record<string, string | number | null | boolean>[] = modelComparison
    .filter((row) => row.Algorithm === "KMeans")
    .map((row) => ({ ...row, selected: Number(row["Number of Clusters"]) === model.clusters }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Customer intelligence"
        title="Customer segments"
        description="K-Means behavioural segmentation across the full customer base. Cluster identifiers are neutral by design; descriptive names require business approval before use."
        actions={
          <Button variant="outline" asChild>
            <Link to="/customers">
              <Users className="h-4 w-4" />
              Customer directory
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Segments"
          value={formatNumber(model.clusters)}
          hint={`K-Means · random state ${model.randomState} · n_init ${model.nInit}`}
          icon={Layers3}
          tone="default"
        />
        <KpiCard
          label="Customers segmented"
          value={formatNumber(model.customers)}
          hint={`${formatNumber(model.features)} behavioural features`}
          icon={Users}
          tone="accent"
        />
        <KpiCard
          label="Silhouette score"
          value={model.silhouette.toFixed(4)}
          hint={`Davies-Bouldin ${model.daviesBouldin.toFixed(4)} · CH ${formatNumber(model.calinskiHarabasz)}`}
          icon={Target}
          tone="teal"
        />
        <KpiCard
          label="Mean ARI across seeds"
          value={model.meanARI.toFixed(4)}
          hint={`Range ${model.minARI.toFixed(4)} – ${model.maxARI.toFixed(4)}`}
          icon={Boxes}
          tone="success"
        />
      </div>

      <InfoNote variant="warning">
        <strong>Model caveats.</strong>
        <ul className="mt-1 list-disc space-y-1 pl-4">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      </InfoNote>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {sizes.map((segment) => (
          <Card key={segment.clusterId} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-sm font-semibold text-white"
                  style={{ backgroundColor: CLUSTER_COLORS[segment.clusterId % CLUSTER_COLORS.length] }}
                >
                  {segment.clusterId}
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">Cluster {segment.clusterId}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatNumber(segment.customers)} customers · {segment.percentage.toFixed(2)}%
                  </p>
                </div>
              </div>
              {segment.isSmall ? <Badge variant="medium">Small group</Badge> : <Badge variant="outline">Stable</Badge>}
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <div>
                <dt className="text-muted-foreground">Avg payment delay</dt>
                <dd className="mt-0.5 font-medium tabular text-foreground">{formatDelayShort(segment.avgPaymentDelay)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Avg late ratio</dt>
                <dd className="mt-0.5 font-medium tabular text-foreground">
                  {formatPercent(segment.avgLatePaymentRatio, true)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Avg invoice count</dt>
                <dd className="mt-0.5 font-medium tabular text-foreground">
                  {formatNumber(segment.medianInvoiceCount)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Invoice frequency</dt>
                <dd className="mt-0.5 font-medium tabular text-foreground">{segment.avgInvoiceFrequency.toFixed(2)}</dd>
              </div>
            </dl>
            <div className="mt-4 flex items-center justify-between border-t border-border/70 pt-3">
              <button
                type="button"
                onClick={() =>
                  setVisibleClusters((current) =>
                    current.length === 1 && current[0] === segment.clusterId ? [] : [segment.clusterId],
                  )
                }
                className="text-[11px] font-medium text-brand-accent hover:underline"
              >
                {visibleClusters.length === 1 && visibleClusters[0] === segment.clusterId ? "Show all" : "Focus in plot"}
              </button>
              <Link
                to={`/customers?cluster=${segment.clusterId}`}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-accent hover:underline"
              >
                View customers
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <ChartCard
          title="Segment landscape (PCA)"
          description={`Two-component PCA projection explaining ${(pca.explainedVariance[0] * 100).toFixed(1)}% + ${(pca.explainedVariance[1] * 100).toFixed(1)}% of variance.`}
          className="lg:col-span-3"
          action={
            visibleClusters.length ? (
              <Button variant="ghost" size="sm" onClick={() => setVisibleClusters([])}>
                Reset view
              </Button>
            ) : null
          }
          footer={pca.note}
        >
          <div className="mb-3 flex flex-wrap gap-1.5">
            {sizes.map((segment) => {
              const active = activeClusters.includes(segment.clusterId);
              return (
                <button
                  key={segment.clusterId}
                  type="button"
                  onClick={() => toggleCluster(segment.clusterId)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-opacity ${
                    active ? "border-border bg-card text-foreground" : "border-border/60 bg-muted text-muted-foreground opacity-50"
                  }`}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: CLUSTER_COLORS[segment.clusterId % CLUSTER_COLORS.length] }}
                  />
                  Cluster {segment.clusterId}
                  <span className="tabular text-muted-foreground">{formatNumber(segment.customers)}</span>
                </button>
              );
            })}
          </div>
          <SegmentScatterChart pca={pca} visibleClusters={activeClusters} />
        </ChartCard>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Model quality</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Recorded cluster validation metrics.</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: "Silhouette score", value: model.silhouette.toFixed(4), hint: "Higher is better · range −1 to 1" },
                { label: "Calinski-Harabasz", value: formatNumber(model.calinskiHarabasz), hint: "Higher is better" },
                { label: "Davies-Bouldin", value: model.daviesBouldin.toFixed(4), hint: "Lower is better" },
                { label: "Mean ARI", value: model.meanARI.toFixed(4), hint: "Agreement across random seeds" },
              ].map((metric) => (
                <div key={metric.label} className="flex items-start justify-between gap-3 border-b border-border/60 pb-2 last:border-0 last:pb-0">
                  <div>
                    <p className="text-xs font-medium text-foreground">{metric.label}</p>
                    <p className="text-[11px] text-muted-foreground">{metric.hint}</p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular text-foreground">{metric.value}</span>
                </div>
              ))}
              <InfoNote variant="info">
                A high silhouette is supported by a dominant cluster. {formatPercent(sizes[0]?.percentage ?? 0)} of
                customers sit in Cluster {sizes[0]?.clusterId ?? 0}; the remaining clusters are small or outlier groups.
              </InfoNote>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Seed stability</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Pairwise adjusted Rand index across K-Means seeds.</p>
            </CardHeader>
            <CardContent className="space-y-2">
              {stability.map((item) => (
                <div key={item.comparison} className="flex items-center gap-3">
                  <span className="w-20 shrink-0 text-[11px] tabular text-muted-foreground">{item.comparison}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-brand-teal" style={{ width: `${item.ARI * 100}%` }} />
                  </div>
                  <span className="w-12 shrink-0 text-right text-[11px] font-medium tabular text-foreground">
                    {item.ARI.toFixed(3)}
                  </span>
                </div>
              ))}
              <p className="pt-2 text-[11px] leading-relaxed text-muted-foreground">
                An ARI of 1.0 means identical assignments. Values above 0.93 indicate stable structure across restarts.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle>Feature heatmap by cluster</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Standardised cluster medians. Positive values sit above the overall median; negative values below.
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-separate border-spacing-1 text-xs">
                <thead>
                  <tr>
                    <th className="w-[170px] pb-1 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Feature
                    </th>
                    {sizes.map((segment) => (
                      <th key={segment.clusterId} className="pb-1 text-center text-[10px] font-semibold text-muted-foreground">
                        C{segment.clusterId}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {heatmap.map((row) => (
                    <tr key={row.feature}>
                      <td className="pr-2 text-[11px] text-muted-foreground">{row.label}</td>
                      {row.values.map((value, index) => {
                        const intensity = Math.min(0.86, (Math.abs(value) / heatmapMax) * 0.86 + 0.06);
                        const background =
                          value >= 0 ? `rgba(180, 83, 9, ${intensity})` : `rgba(38, 117, 216, ${intensity})`;
                        return (
                          <td
                            key={`${row.feature}-${index}`}
                            className="rounded text-center text-[10px] font-medium tabular"
                            style={{
                              backgroundColor: background,
                              color: intensity > 0.45 ? "#FFFFFF" : "#17243A",
                            }}
                            title={`${row.label} · Cluster ${index} · standardised median ${value.toFixed(
                              2,
                            )} · raw median ${formatNumber(row.medians[index], true)}`}
                          >
                            <span className="block px-1.5 py-2">{value.toFixed(2)}</span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
              <span>Below median</span>
              <span className="h-2 w-16 rounded-full bg-[#2675D8]/70" />
              <span className="h-2 w-8 rounded-full bg-[#2675D8]/20" />
              <span className="h-2 w-1 rounded-full bg-border" />
              <span className="h-2 w-8 rounded-full bg-[#B45309]/20" />
              <span className="h-2 w-16 rounded-full bg-[#B45309]/70" />
              <span>Above median</span>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-3">
            <div>
              <CardTitle>Distribution by cluster</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Quartiles, whiskers and medians.</p>
            </div>
            <Select
              aria-label="Feature"
              className="h-8 w-[150px] text-xs"
              value={featureIndex}
              onChange={(event) => setFeatureIndex(Number(event.target.value))}
            >
              {featureComparison.map((feature, index) => (
                <option key={feature.feature} value={index}>
                  {feature.label}
                </option>
              ))}
            </Select>
          </CardHeader>
          <CardContent>
            <BoxPlot
              rows={selectedFeature.clusters.map((cluster) => ({
                label: `Cluster ${cluster.clusterId}`,
                color: CLUSTER_COLORS[cluster.clusterId % CLUSTER_COLORS.length],
                min: cluster.min,
                q1: cluster.q1,
                median: cluster.median,
                q3: cluster.q3,
                max: cluster.max,
                count: cluster.count,
              }))}
              valueFormatter={boxFormatter(selectedFeature.feature)}
            />
            <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
              Whiskers show observed minimum and maximum values within each cluster. Small clusters can have identical
              quartiles, which appears as a narrow box.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Cluster count selection</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            K-Means validation across candidate cluster counts. The production configuration is K={model.clusters}.
          </p>
        </CardHeader>
        <CardContent className="px-0 pb-2">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-semibold">K</th>
                  <th className="px-4 py-2 text-right font-semibold">Silhouette</th>
                  <th className="px-4 py-2 text-right font-semibold">Calinski-Harabasz</th>
                  <th className="px-4 py-2 text-right font-semibold">Davies-Bouldin</th>
                  <th className="px-4 py-2 text-right font-semibold">Min cluster</th>
                  <th className="px-4 py-2 text-right font-semibold">Max cluster</th>
                  <th className="px-4 py-2 text-right font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row) => (
                  <tr
                    key={`${row.Algorithm}-${row.Parameters}`}
                    className={row.selected ? "border-b border-border/60 bg-primary-soft/50" : "border-b border-border/60"}
                  >
                    <td className="px-4 py-2 font-medium tabular text-foreground">{row["Number of Clusters"]}</td>
                    <td className="px-4 py-2 text-right tabular text-foreground">{Number(row["Silhouette Score"]).toFixed(4)}</td>
                    <td className="px-4 py-2 text-right tabular text-muted-foreground">
                      {formatNumber(Number(row["Calinski-Harabasz Score"]))}
                    </td>
                    <td className="px-4 py-2 text-right tabular text-muted-foreground">
                      {Number(row["Davies-Bouldin Score"]).toFixed(4)}
                    </td>
                    <td className="px-4 py-2 text-right tabular text-muted-foreground">
                      {formatNumber(Number(row["Minimum Cluster Size"]))}
                    </td>
                    <td className="px-4 py-2 text-right tabular text-muted-foreground">
                      {formatNumber(Number(row["Maximum Cluster Size"]))}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {row.selected ? <Badge variant="accent">Production</Badge> : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 pt-3 text-[11px] leading-relaxed text-muted-foreground">
            Silhouette peaks at K=2 in the validation table. K=6 is the recorded production configuration, so cluster count
            reflects a modelling decision beyond the silhouette optimum. Review business usefulness before treating segment
            labels as final.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
