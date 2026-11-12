import { Link, useSearchParams } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  BarChart3,
  BookOpen,
  Bot,
  CheckCircle2,
  Gauge,
  Layers,
  Target,
  TimerReset,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useModelMetrics } from "@/api/queries";
import { PageHeader } from "@/components/common/page-header";
import { KpiCard } from "@/components/common/kpi-card";
import { ChartCard } from "@/components/common/chart-card";
import { InfoNote } from "@/components/common/notes";
import { ErrorState } from "@/components/common/states";
import { PageSkeleton } from "@/components/common/loading";
import { RocCurveChart, PrecisionRecallChart } from "@/components/charts/roc-pr-chart";
import { ThresholdChart } from "@/components/charts/threshold-chart";
import { ScatterPlot } from "@/components/charts/scatter-plot";
import { FeatureBars } from "@/components/charts/feature-bars";
import { SegmentScatterChart } from "@/components/charts/segment-scatter-chart";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CHART_COLORS, CLUSTER_COLORS } from "@/lib/constants";
import {
  formatDate,
  formatDelayShort,
  formatNumber,
  formatPercent,
} from "@/lib/format";
import type {
  ClusteringModelMetrics,
  ConfusionMatrix,
  LatePaymentModelMetrics,
  PaymentDelayModelMetrics,
} from "@/types";

function rangeLabel(range: string[] | undefined) {
  if (!range?.length) return "Not recorded";
  return `${formatDate(range[0])} → ${formatDate(range[1])}`;
}

function ConfusionMatrixGrid({ matrix, label }: { matrix: ConfusionMatrix; label: string }) {
  const { trueNegative, falsePositive, falseNegative, truePositive } = matrix;
  const total = trueNegative + falsePositive + falseNegative + truePositive;
  const precision = truePositive + falsePositive > 0 ? truePositive / (truePositive + falsePositive) : 0;
  const recall = truePositive + falseNegative > 0 ? truePositive / (truePositive + falseNegative) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const cells = [
    {
      title: "True negative",
      count: trueNegative,
      className: "border-border bg-muted/50 text-foreground",
    },
    {
      title: "False positive",
      count: falsePositive,
      className: "border-risk-medium/25 bg-risk-medium-soft text-[#7C4A03]",
    },
    {
      title: "False negative",
      count: falseNegative,
      className: "border-risk-high/25 bg-risk-high-soft text-[#991B1B]",
    },
    {
      title: "True positive",
      count: truePositive,
      className: "border-risk-low/20 bg-risk-low-soft text-[#166534]",
    },
  ];

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">Confusion matrix</p>
          <p className="text-[11px] text-muted-foreground">{label}</p>
        </div>
        <Badge variant="accent">Threshold {matrix.threshold.toFixed(2)}</Badge>
      </div>
      <div className="mt-3 grid grid-cols-[70px_1fr_1fr] gap-1.5 text-[11px]">
        <div />
        <div className="pb-1 text-center font-medium text-muted-foreground">Pred. on time</div>
        <div className="pb-1 text-center font-medium text-muted-foreground">Pred. late</div>
        <div className="flex items-center font-medium text-muted-foreground">Actual on time</div>
        {cells.slice(0, 2).map((cell) => (
          <div key={cell.title} className={`rounded-lg border p-2 text-center ${cell.className}`}>
            <p className="text-base font-semibold tabular">{formatNumber(cell.count)}</p>
            <p className="text-[10px] opacity-80">{cell.title}</p>
          </div>
        ))}
        <div className="flex items-center font-medium text-muted-foreground">Actual late</div>
        {cells.slice(2).map((cell) => (
          <div key={cell.title} className={`rounded-lg border p-2 text-center ${cell.className}`}>
            <p className="text-base font-semibold tabular">{formatNumber(cell.count)}</p>
            <p className="text-[10px] opacity-80">{cell.title}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border/70 pt-3 text-[11px] sm:grid-cols-4">
        {[
          { label: "Precision", value: precision },
          { label: "Recall", value: recall },
          { label: "F1", value: f1 },
          { label: "Accuracy", value: matrix.accuracy },
        ].map((metric) => (
          <div key={metric.label} className="flex items-center justify-between gap-2 sm:flex-col sm:items-start">
            <span className="text-muted-foreground">{metric.label}</span>
            <span className="font-semibold tabular text-foreground">{formatPercent(metric.value, true, 2)}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">n = {formatNumber(total)} test invoices</p>
    </div>
  );
}

function LatePaymentPanel({ metrics }: { metrics: LatePaymentModelMetrics }) {
  const test = metrics.testMetrics;
  return (
    <div className="space-y-4">
      <InfoNote>
        <strong>Threshold context.</strong> Recorded test metrics use the 0.45 decision threshold. The confusion matrix at
        0.50 shows the default threshold for comparison. ROC-AUC and PR-AUC are threshold-independent.
      </InfoNote>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="ROC-AUC" value={metrics.rocAuc.toFixed(4)} hint="Threshold-independent ranking quality" icon={Target} tone="accent" />
        <KpiCard label="PR-AUC" value={metrics.prAuc.toFixed(4)} hint="Precision-recall area on the test set" icon={Activity} tone="teal" />
        <KpiCard label="Accuracy" value={formatPercent(test.accuracy, true, 2)} hint={`At threshold ${metrics.decisionThreshold}`} icon={CheckCircle2} tone="success" />
        <KpiCard label="Recall" value={formatPercent(test.recall, true, 2)} hint={`F1 ${formatPercent(test.f1, true, 2)} · Precision ${formatPercent(test.precision, true, 2)}`} icon={Gauge} tone="warning" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Model metadata</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">Recorded training configuration and chronological evaluation splits.</p>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Algorithm", value: metrics.algorithm },
              { label: "Model version", value: metrics.version ?? "Not recorded" },
              { label: "Dataset version", value: metrics.datasetVersion ?? "Not recorded" },
              { label: "Trained at", value: metrics.trainedAt ? formatDate(metrics.trainedAt) : "Not recorded" },
              { label: "Training rows", value: formatNumber(metrics.trainingRows) },
              { label: "Validation rows", value: formatNumber(metrics.validationRows) },
              { label: "Test rows", value: formatNumber(metrics.testRows) },
              { label: "Decision threshold", value: metrics.decisionThreshold.toFixed(2) },
            ].map((item) => (
              <div key={item.label}>
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{item.label}</dt>
                <dd className="mt-0.5 truncate font-medium text-foreground">{item.value}</dd>
              </div>
            ))}
            <div className="sm:col-span-2">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Training window</dt>
              <dd className="mt-0.5 font-medium text-foreground">{rangeLabel(metrics.trainingDateRange)}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Validation window</dt>
              <dd className="mt-0.5 font-medium text-foreground">{rangeLabel(metrics.validationDateRange)}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Test window</dt>
              <dd className="mt-0.5 font-medium text-foreground">{rangeLabel(metrics.testDateRange)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="ROC curve" description="True positive rate versus false positive rate on the held-out chronological test set." footer="Recomputed from saved test labels and probabilities.">
          <RocCurveChart data={metrics.rocCurve} auc={metrics.rocAuc} />
        </ChartCard>
        <ChartCard title="Precision-recall curve" description="Trade-off between precision and recall at varying thresholds." footer="PR-AUC is informative when late invoices are a minority class.">
          <PrecisionRecallChart data={metrics.prCurve} prAuc={metrics.prAuc} />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ConfusionMatrixGrid matrix={metrics.confusionMatrix} label="Recorded binary decision at the operational threshold" />
        <ConfusionMatrixGrid matrix={metrics.confusionMatrixDefault} label="Default 0.50 threshold, shown for comparison" />
      </div>

      <ChartCard
        title="Metrics across thresholds"
        description="How precision, recall, F1 and accuracy change as the probability cut-off moves."
        footer={`Decision threshold ${metrics.decisionThreshold} is marked. Bands are separate from this cut-off.`}
      >
        <ThresholdChart data={metrics.thresholdAnalysis} decisionThreshold={metrics.decisionThreshold} height={320} />
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Global feature importance</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Gain-based importance recorded from the trained classifier.</p>
          </CardHeader>
          <CardContent>
            <FeatureBars items={metrics.featureImportance} limit={10} barClassName="bg-brand-accent" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Algorithm comparison</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Recorded test metrics across candidate classifiers.</p>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 text-left font-semibold">Model</th>
                    <th className="px-3 py-2 text-right font-semibold">Accuracy</th>
                    <th className="px-3 py-2 text-right font-semibold">Precision</th>
                    <th className="px-3 py-2 text-right font-semibold">Recall</th>
                    <th className="px-3 py-2 text-right font-semibold">F1</th>
                    <th className="px-3 py-2 text-right font-semibold">ROC-AUC</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.modelComparison.map((row) => {
                    const selected = String(row.model) === "XGBoost";
                    return (
                      <tr key={String(row.model)} className={selected ? "border-b border-border/60 bg-primary-soft/50" : "border-b border-border/60"}>
                        <td className="px-4 py-2 font-medium text-foreground">
                          {row.model} {selected ? <Badge variant="accent" className="ml-1">Production</Badge> : null}
                        </td>
                        <td className="px-3 py-2 text-right tabular">{formatPercent(Number(row.accuracy), true)}</td>
                        <td className="px-3 py-2 text-right tabular">{formatPercent(Number(row.precision), true)}</td>
                        <td className="px-3 py-2 text-right tabular">{formatPercent(Number(row.recall), true)}</td>
                        <td className="px-3 py-2 text-right tabular">{formatPercent(Number(row.f1), true)}</td>
                        <td className="px-3 py-2 text-right tabular">{Number(row.roc_auc).toFixed(4)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="px-4 pt-3 text-[10px] leading-relaxed text-muted-foreground">{metrics.metricSource}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ResidualChart({ data }: { data: PaymentDelayModelMetrics["residualDistribution"] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
        <XAxis
          dataKey="center"
          tickFormatter={(value: number) => `${value}d`}
          tick={{ fontSize: 10, fill: CHART_COLORS.axis }}
          tickLine={false}
          axisLine={{ stroke: CHART_COLORS.grid }}
          minTickGap={26}
        />
        <YAxis tick={{ fontSize: 11, fill: CHART_COLORS.axis }} tickLine={false} axisLine={false} width={40} />
        <Tooltip
          cursor={{ fill: "#F1F5FB" }}
          content={
            <ChartTooltip
              labelFormatter={(label) => `Residual ${Number(label)} days`}
              formatter={(value) => formatNumber(Number(value))}
            />
          }
        />
        <ReferenceLine x={0} stroke={CHART_COLORS.axis} strokeDasharray="4 4" />
        <Bar dataKey="count" name="Invoices" radius={[2, 2, 0, 0]}>
          {data.map((item) => (
            <Cell key={item.center} fill={item.center < 0 ? CHART_COLORS.teal : item.center > 0 ? CHART_COLORS.red : CHART_COLORS.amber} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function DelayPanel({ metrics }: { metrics: PaymentDelayModelMetrics }) {
  const test = metrics.testMetrics;
  return (
    <div className="space-y-4">
      <InfoNote>
        <strong>Regression context.</strong> Delay is a signed day target. MAE and RMSE are in days; lower is better. R² of{" "}
        {test.R2.toFixed(4)} means the model explains about {(test.R2 * 100).toFixed(1)}% of test-set variance, so
        individual predictions carry material error.
      </InfoNote>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Test MAE" value={test.MAE.toFixed(4)} hint="Mean absolute error in days" icon={TimerReset} tone="accent" />
        <KpiCard label="Test RMSE" value={test.RMSE.toFixed(4)} hint="Penalises large errors more heavily" icon={Activity} tone="warning" />
        <KpiCard label="Test R²" value={test.R2.toFixed(4)} hint="Variance explained on held-out data" icon={Target} tone="teal" />
        <KpiCard label="Test MedAE" value={test.MedAE.toFixed(4)} hint="Median absolute error in days" icon={Gauge} tone="success" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Model metadata and validation</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">Validation metrics are shown alongside the final test evaluation.</p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 lg:grid-cols-2">
            <dl className="grid grid-cols-2 gap-3 text-xs">
              {[
                { label: "Algorithm", value: metrics.algorithm },
                { label: "Version", value: metrics.version ?? "Not recorded" },
                { label: "Training rows", value: formatNumber(metrics.trainingRows) },
                { label: "Validation rows", value: formatNumber(metrics.validationRows) },
                { label: "Test rows", value: formatNumber(metrics.testRows) },
                { label: "Features", value: formatNumber(metrics.features) },
              ].map((item) => (
                <div key={item.label}>
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{item.label}</dt>
                  <dd className="mt-0.5 font-medium text-foreground">{item.value}</dd>
                </div>
              ))}
            </dl>
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 text-left font-semibold">Metric</th>
                    <th className="px-3 py-2 text-right font-semibold">Validation</th>
                    <th className="px-3 py-2 text-right font-semibold">Test</th>
                  </tr>
                </thead>
                <tbody>
                  {(["MAE", "RMSE", "R2", "MedAE"] as const).map((key) => (
                    <tr key={key} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-2 font-medium text-foreground">{key === "R2" ? "R²" : key}</td>
                      <td className="px-3 py-2 text-right tabular text-muted-foreground">{metrics.validationMetrics[key].toFixed(4)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular text-foreground">{metrics.testMetrics[key].toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{metrics.selection}</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Actual versus predicted delay" description="Each point is a test invoice. The diagonal marks perfect prediction." footer={`${formatNumber(metrics.actualVsPredicted.length)} test invoices plotted.`}>
          <ScatterPlot
            data={metrics.actualVsPredicted}
            xKey="actual"
            yKey="predicted"
            xLabel="Actual delay (days)"
            yLabel="Predicted delay (days)"
            diagonal
            color={CHART_COLORS.teal}
            formatter={(value) => formatDelayShort(value)}
            height={340}
          />
        </ChartCard>
        <ChartCard title="Residual distribution" description="Prediction error (actual minus predicted) across test invoices." footer="Errors on both sides of zero indicate no systematic directional bias in aggregate.">
          <ResidualChart data={metrics.residualDistribution} />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Error by invoice amount</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Recorded test performance across amount bands.</p>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 text-left font-semibold">Amount band</th>
                    <th className="px-3 py-2 text-right font-semibold">MAE</th>
                    <th className="px-3 py-2 text-right font-semibold">RMSE</th>
                    <th className="px-3 py-2 text-right font-semibold">MedAE</th>
                    <th className="px-3 py-2 text-right font-semibold">n</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.byAmountBucket.map((row) => (
                    <tr key={String(row.bucket)} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2 font-medium text-foreground">{row.bucket}</td>
                      <td className="px-3 py-2 text-right tabular">{Number(row.MAE).toFixed(4)}</td>
                      <td className="px-3 py-2 text-right tabular text-muted-foreground">{Number(row.RMSE).toFixed(4)}</td>
                      <td className="px-3 py-2 text-right tabular text-muted-foreground">{Number(row.MedAE).toFixed(4)}</td>
                      <td className="px-3 py-2 text-right tabular text-muted-foreground">{formatNumber(Number(row.n))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Error by timing category</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Early, on-time and late test invoices.</p>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 text-left font-semibold">Category</th>
                    <th className="px-3 py-2 text-right font-semibold">MAE</th>
                    <th className="px-3 py-2 text-right font-semibold">RMSE</th>
                    <th className="px-3 py-2 text-right font-semibold">MedAE</th>
                    <th className="px-3 py-2 text-right font-semibold">n</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.byCategory.map((row) => (
                    <tr key={String(row.category)} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2 font-medium text-foreground">{row.category}</td>
                      <td className="px-3 py-2 text-right tabular">{Number(row.MAE).toFixed(4)}</td>
                      <td className="px-3 py-2 text-right tabular text-muted-foreground">{Number(row.RMSE).toFixed(4)}</td>
                      <td className="px-3 py-2 text-right tabular text-muted-foreground">{Number(row.MedAE).toFixed(4)}</td>
                      <td className="px-3 py-2 text-right tabular text-muted-foreground">{formatNumber(Number(row.n))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Feature importance</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Recorded global drivers of predicted delay.</p>
          </CardHeader>
          <CardContent>
            <FeatureBars items={metrics.featureImportance} limit={10} barClassName="bg-brand-teal" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Algorithm comparison</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Recorded validation and test experiments for the delay regressor.</p>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 text-left font-semibold">Model</th>
                    <th className="px-3 py-2 text-right font-semibold">MAE</th>
                    <th className="px-3 py-2 text-right font-semibold">RMSE</th>
                    <th className="px-3 py-2 text-right font-semibold">R²</th>
                    <th className="px-3 py-2 text-right font-semibold">MedAE</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.modelComparison.map((row) => {
                    const selected = String(row.model) === "HistGradientBoosting";
                    return (
                      <tr key={String(row.model)} className={selected ? "border-b border-border/60 bg-primary-soft/50" : "border-b border-border/60"}>
                        <td className="px-4 py-2 font-medium text-foreground">
                          {row.model} {selected ? <Badge variant="accent" className="ml-1">Production</Badge> : null}
                        </td>
                        <td className="px-3 py-2 text-right tabular">{Number(row.MAE).toFixed(4)}</td>
                        <td className="px-3 py-2 text-right tabular text-muted-foreground">{Number(row.RMSE).toFixed(4)}</td>
                        <td className="px-3 py-2 text-right tabular text-muted-foreground">{Number(row.R2).toFixed(4)}</td>
                        <td className="px-3 py-2 text-right tabular text-muted-foreground">{Number(row.MedAE).toFixed(4)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="px-4 pt-3 text-[10px] leading-relaxed text-muted-foreground">{metrics.metricSource}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ClusteringPanel({ metrics }: { metrics: ClusteringModelMetrics }) {
  const kmeansRows: Record<string, string | number | null | boolean>[] = metrics.modelComparison
    .filter((row) => row.Algorithm === "KMeans")
    .map((row) => ({ ...row, selected: Number(row["Number of Clusters"]) === metrics.clusters }));

  return (
    <div className="space-y-4">
      <InfoNote variant="warning">
        <strong>Cluster count.</strong> Silhouette peaks at K=2 in the recorded comparison, while the production artifact uses
        K={metrics.clusters}. Segment labels therefore reflect a modelling and interpretability decision, not a pure
        silhouette optimum. Clusters are highly imbalanced.
      </InfoNote>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Silhouette score" value={metrics.silhouette.toFixed(4)} hint="Higher is better" icon={Target} tone="teal" />
        <KpiCard label="Calinski-Harabasz" value={formatNumber(metrics.calinskiHarabasz)} hint="Higher is better" icon={BarChart3} tone="accent" />
        <KpiCard label="Davies-Bouldin" value={metrics.daviesBouldin.toFixed(4)} hint="Lower is better" icon={Gauge} tone="warning" />
        <KpiCard label="Mean ARI" value={metrics.stability.mean_ARI.toFixed(4)} hint={`${metrics.stability.seeds.length} random seeds`} icon={CheckCircle2} tone="success" />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <ChartCard
          title="Segment landscape (PCA)"
          description="Two-component projection across all segmented customers."
          className="lg:col-span-3"
          footer={metrics.pca.note}
        >
          <SegmentScatterChart pca={metrics.pca} height={380} />
        </ChartCard>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle>Segment sizes</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Customer allocation for the production clustering.</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {metrics.sizes.map((segment) => (
              <div key={segment.clusterId} className="flex items-center gap-3">
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] font-semibold text-white"
                  style={{ backgroundColor: CLUSTER_COLORS[segment.clusterId % CLUSTER_COLORS.length] }}
                >
                  {segment.clusterId}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(segment.percentage, 0.5)}%`,
                      backgroundColor: CLUSTER_COLORS[segment.clusterId % CLUSTER_COLORS.length],
                    }}
                  />
                </div>
                <span className="w-14 shrink-0 text-right text-[11px] font-medium tabular text-foreground">
                  {formatNumber(segment.customers)}
                </span>
                <span className="w-12 shrink-0 text-right text-[10px] tabular text-muted-foreground">
                  {segment.percentage.toFixed(2)}%
                </span>
              </div>
            ))}
            <p className="border-t border-border/70 pt-2 text-[11px] leading-relaxed text-muted-foreground">
              Mean ARI {metrics.stability.mean_ARI.toFixed(4)} across seeds {metrics.stability.seeds.join(", ")}. Minimum{" "}
              {metrics.stability.min_ARI.toFixed(4)} · maximum {metrics.stability.max_ARI.toFixed(4)}.
            </p>
            <Button variant="outline" size="sm" className="mt-2 w-full" asChild>
              <Link to="/customer-segments">
                <Layers className="h-3.5 w-3.5" />
                Open full segment explorer
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Cluster count comparison</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">Recorded K-Means validation across candidate K values.</p>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 text-left font-semibold">K</th>
                  <th className="px-3 py-2 text-right font-semibold">Silhouette</th>
                  <th className="px-3 py-2 text-right font-semibold">Calinski-Harabasz</th>
                  <th className="px-3 py-2 text-right font-semibold">Davies-Bouldin</th>
                  <th className="px-3 py-2 text-right font-semibold">Min size</th>
                  <th className="px-3 py-2 text-right font-semibold">Max size</th>
                  <th className="px-3 py-2 text-right font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {kmeansRows.map((row) => (
                  <tr key={String(row.Parameters)} className={row.selected ? "border-b border-border/60 bg-primary-soft/50" : "border-b border-border/60"}>
                    <td className="px-4 py-2 font-medium tabular text-foreground">{row["Number of Clusters"]}</td>
                    <td className="px-3 py-2 text-right tabular">{row["Silhouette Score"] == null ? "—" : Number(row["Silhouette Score"]).toFixed(4)}</td>
                    <td className="px-3 py-2 text-right tabular text-muted-foreground">
                      {row["Calinski-Harabasz Score"] == null ? "—" : formatNumber(Number(row["Calinski-Harabasz Score"]))}
                    </td>
                    <td className="px-3 py-2 text-right tabular text-muted-foreground">
                      {row["Davies-Bouldin Score"] == null ? "—" : Number(row["Davies-Bouldin Score"]).toFixed(4)}
                    </td>
                    <td className="px-3 py-2 text-right tabular text-muted-foreground">
                      {row["Minimum Cluster Size"] == null ? "—" : formatNumber(Number(row["Minimum Cluster Size"]))}
                    </td>
                    <td className="px-3 py-2 text-right tabular text-muted-foreground">
                      {row["Maximum Cluster Size"] == null ? "—" : formatNumber(Number(row["Maximum Cluster Size"]))}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {row.selected ? <Badge variant="accent">Production</Badge> : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 pt-3 text-[10px] leading-relaxed text-muted-foreground">{metrics.metricSource}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function MethodologyPanel() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-brand-accent" />
            Metric provenance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-xs leading-relaxed text-muted-foreground">
          <p>
            Every metric on this page is copied from recorded model metadata and reports. ROC-AUC, PR-AUC, curves and
            confusion matrices are recomputed from saved test predictions. No metric is recalculated from fabricated inputs.
          </p>
          <p>
            The browser never loads joblib artifacts or executes model training. Inference must run on the backend with the
            matching saved preprocessing pipeline.
          </p>
          <InfoNote variant="success">
            <strong>No retraining in the interface.</strong> Model versions, thresholds and segments come from the supplied
            artifacts.
          </InfoNote>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Threshold and bands</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-xs leading-relaxed text-muted-foreground">
          <p>
            The 0.45 probability cut-off defines the binary late/on-time label used in classification metrics. Operational
            risk bands (Low &lt; 0.30, Medium 0.30–0.70, High ≥ 0.70) communicate severity and do not alter that binary
            decision.
          </p>
          <p>
            The delay regressor is evaluated with MAE, RMSE, R² and MedAE in days. Segment structure is evaluated with
            silhouette, Calinski-Harabasz, Davies-Bouldin and adjusted Rand index across seeds.
          </p>
          <InfoNote variant="warning">
            <strong>Decision support only.</strong> Historical performance does not guarantee individual accuracy. Do not
            use these outputs as the sole basis for adverse customer decisions.
          </InfoNote>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle>Integration checklist</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">What the backend must provide for these views to run in live mode.</p>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            {[
              "Model metadata and version identifiers",
              "Saved test probabilities and labels for curves and thresholds",
              "Confusion matrices at the recorded and default thresholds",
              "Global feature importance arrays with stable feature keys",
              "Delay test predictions for scatter and residual diagnostics",
              "Segmentation metrics, PCA coordinates and cluster profiles",
              "SHAP values only if genuinely produced by the inference service",
              "Health and dataset inventory endpoints for workspace status",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 rounded-lg border border-border/70 px-3 py-2">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-teal" />
                {item}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/settings?tab=api">
                View API contract
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/insights">Explainability overview</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ModelPerformancePage() {
  const { data, isLoading, isError, error, refetch } = useModelMetrics();
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("model") ?? "late-payment";
  const tab = requested === "payment-delay" ? "delay" : requested === "clustering" ? "clustering" : requested === "methodology" ? "methodology" : "late";

  if (isLoading) return <PageSkeleton />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Model metrics could not be loaded"
        description={error instanceof Error ? error.message : "The model metrics endpoint did not respond."}
        onRetry={() => refetch()}
      />
    );
  }

  function handleTab(value: string) {
    const next = new URLSearchParams(searchParams);
    next.set("model", value === "late" ? "late-payment" : value === "delay" ? "payment-delay" : value === "clustering" ? "clustering" : "methodology");
    setSearchParams(next, { replace: true });
  }

  const summary = [
    {
      id: "late",
      name: data.latePayment.name,
      algorithm: data.latePayment.algorithm,
      metric: `ROC-AUC ${data.latePayment.rocAuc.toFixed(4)}`,
      icon: Target,
      value: "late",
    },
    {
      id: "delay",
      name: data.paymentDelay.name,
      algorithm: data.paymentDelay.algorithm,
      metric: `MAE ${data.paymentDelay.testMetrics.MAE.toFixed(4)} days`,
      icon: TimerReset,
      value: "delay",
    },
    {
      id: "clustering",
      name: data.clustering.name,
      algorithm: data.clustering.algorithm,
      metric: `Silhouette ${data.clustering.silhouette.toFixed(4)}`,
      icon: Layers,
      value: "clustering",
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Models & data"
        title="Model performance"
        description="Recorded evaluation for the three production artifacts. Metrics describe historical, held-out test periods and are not guarantees of individual prediction accuracy."
        actions={
          <Button variant="outline" asChild>
            <Link to="/insights">
              <Bot className="h-4 w-4" />
              Explainability
            </Link>
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {summary.map((item) => {
          const active = tab === item.value;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleTab(item.value)}
              className={`flex items-start gap-3 rounded-xl border p-4 text-left shadow-card transition-colors ${
                active ? "border-brand-accent/50 bg-primary-soft/60" : "border-border bg-card hover:border-brand-accent/30"
              }`}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-card text-brand-accent shadow-sm">
                <item.icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-foreground">{item.name}</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">{item.algorithm}</span>
                <span className="mt-1 block text-[11px] font-medium tabular text-brand-navy">{item.metric}</span>
              </span>
            </button>
          );
        })}
      </div>

      <Tabs value={tab} onValueChange={handleTab}>
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="late">Late-payment classifier</TabsTrigger>
          <TabsTrigger value="delay">Delay regressor</TabsTrigger>
          <TabsTrigger value="clustering">Customer segments</TabsTrigger>
          <TabsTrigger value="methodology">Methodology</TabsTrigger>
        </TabsList>

        <TabsContent value="late">
          <LatePaymentPanel metrics={data.latePayment} />
        </TabsContent>
        <TabsContent value="delay">
          <DelayPanel metrics={data.paymentDelay} />
        </TabsContent>
        <TabsContent value="clustering">
          <ClusteringPanel metrics={data.clustering} />
        </TabsContent>
        <TabsContent value="methodology">
          <MethodologyPanel />
        </TabsContent>
      </Tabs>

      <InfoNote>
        <strong>Recorded methodology.</strong> {data.methodology.note} {data.methodology.disclaimer}
      </InfoNote>
    </div>
  );
}
