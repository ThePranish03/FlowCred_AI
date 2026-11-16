import { useMemo, useState } from "react";
import {
  CalendarRange,
  CircleDollarSign,
  Gauge,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { ChartCard } from "@/components/common/chart-card";
import { KpiCard } from "@/components/common/kpi-card";
import { InfoNote, SectionHeading } from "@/components/common/notes";
import { EmptyState, ErrorState } from "@/components/common/states";
import { CashFlowForecastChart } from "@/components/charts/cash-flow-forecast-chart";
import { ForecastBakeoff, MODEL_LABELS, SCOPE_LABELS } from "@/components/charts/forecast-bakeoff";
import { ForecastStability } from "@/components/charts/forecast-stability";
import { ForecastResiduals } from "@/components/charts/forecast-residuals";
import { AlgorithmCards } from "@/components/cash-flow/algorithm-cards";
import { PipelineFlow } from "@/components/cash-flow/pipeline-flow";
import { ResearchPanel } from "@/components/cash-flow/research-panel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCashFlowDiagnostics, useCashFlowForecast, useCashFlowHealth } from "@/api/queries";
import type { CashFlowDiagnostics, DiagnosticsScope } from "@/types";
import { formatCurrency, formatDate, formatPercent, formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const HORIZONS = [7, 30, 90] as const;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function describeError(error: unknown): { message: string; unauthorised: boolean } {
  const failure = (error ?? {}) as { status?: number; message?: string };
  if (failure.status === 401) {
    return {
      message: "You are not signed in, or your session expired. Sign in again to load the forecast.",
      unauthorised: true,
    };
  }
  if (failure.status === 503) {
    return {
      message:
        failure.message ??
        "The cash-flow forecasting artifact is not available on this server. The three core models are unaffected.",
      unauthorised: false,
    };
  }
  return { message: failure.message ?? "The forecast could not be loaded.", unauthorised: false };
}

export default function CashFlowForecastPage() {
  const [currency, setCurrency] = useState<"USD" | "CAD">("USD");
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>(30);
  const [asOf, setAsOf] = useState<string>("");
  const [scope, setScope] = useState<DiagnosticsScope>("weekly");
  const [metric, setMetric] = useState<"wape" | "holdout">("wape");

  const forecastQuery = useCashFlowForecast({ currency, horizon, asOf: asOf || undefined });
  const diagnosticsQuery = useCashFlowDiagnostics();
  const healthQuery = useCashFlowHealth();

  const data = forecastQuery.data;
  const diagnostics: CashFlowDiagnostics | undefined = diagnosticsQuery.data;
  const bundle = diagnostics?.currencies?.[currency];
  const candidates = bundle?.candidates ?? [];
  const decision = bundle?.decision;
  const research = diagnostics?.research;
  const isLoading = forecastQuery.isLoading;
  const errorInfo = describeError(forecastQuery.error);

  const originOptions = useMemo(() => {
    const points = bundle?.perOrigin?.[decision?.selected ?? ""] ?? [];
    return points.map((p) => ({ value: p.asOf, label: formatShortDate(p.asOf) }));
  }, [bundle, decision?.selected]);

  const health = healthQuery.data;
  const healthTone =
    health?.status === "available" ? "low" : health?.status === "partial" ? "medium" : "muted";

  const selectedCandidate = candidates.find((c) => c.selected);
  const weekly = selectedCandidate?.scopes.weekly;
  const improvement =
    decision?.baselineWape && decision?.selectedWape
      ? (decision.baselineWape - decision.selectedWape) / decision.baselineWape
      : null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace"
        title="Cash flow forecast"
        description="Weekly collection forecast per currency, with the backtest evidence that justifies the model choice."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={healthTone as "low" | "medium" | "muted"}>
              <ShieldCheck className="h-3 w-3" />
              {health?.status === "available"
                ? "Forecasting available"
                : health?.status === "partial"
                  ? "Partial availability"
                  : "Forecasting unavailable"}
            </Badge>
            <Badge variant="medium">Historical simulation</Badge>
          </div>
        }
      />

      {/* Controls */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Currency
              </label>
              <Select
                value={currency}
                onChange={(event) => {
                  setCurrency(event.target.value as "USD" | "CAD");
                  setAsOf("");
                }}
              >
                <option value="USD">USD</option>
                <option value="CAD">CAD</option>
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Horizon
              </label>
              <Select
                value={String(horizon)}
                onChange={(event) => setHorizon(Number(event.target.value) as (typeof HORIZONS)[number])}
              >
                {HORIZONS.map((value) => (
                  <option key={value} value={value}>
                    {value} days
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Forecast origin (replay)
              </label>
              <Select value={asOf} onChange={(event) => setAsOf(event.target.value)}>
                <option value="">Latest · {data ? formatShortDate(data.trainedThrough) : "artifact cutoff"}</option>
                {originOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {data ? (
            <div className="text-xs leading-relaxed text-muted-foreground lg:text-right">
              <p>
                Model{" "}
                <span className="font-medium text-foreground">
                  {MODEL_LABELS[data.model.algorithm] ?? data.model.algorithm}
                </span>
              </p>
              <p>
                Trained through{" "}
                <span className="font-medium text-foreground">{formatDate(data.trainedThrough)}</span>
                {data.isReplay ? " · replayed origin" : ""}
              </p>
            </div>
          ) : null}
        </div>
      </Card>

      {forecastQuery.isError ? (
        <Card>
          <ErrorState
            title={errorInfo.unauthorised ? "Sign-in required" : "Forecast unavailable"}
            description={errorInfo.message}
            onRetry={() => forecastQuery.refetch()}
          />
          {errorInfo.unauthorised ? (
            <div className="flex justify-center pb-6">
              <a
                href="/login"
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
              >
                Go to sign in
              </a>
            </div>
          ) : null}
        </Card>
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label={`${horizon}-day forecast`}
              value={formatCurrency(data?.totals.predicted, currency, true)}
              hint={data ? `Origin ${formatShortDate(data.asOf)}` : undefined}
              icon={CircleDollarSign}
              tone="accent"
              loading={isLoading}
            />
            <KpiCard
              label="Interval low"
              value={formatCurrency(data?.totals.lower, currency, true)}
              hint="Empirical backtest quantile"
              icon={TriangleAlert}
              tone="warning"
              loading={isLoading}
            />
            <KpiCard
              label="Interval high"
              value={formatCurrency(data?.totals.upper, currency, true)}
              hint="Empirical backtest quantile"
              icon={Gauge}
              tone="teal"
              loading={isLoading}
            />
            <KpiCard
              label="Evidence"
              value={weekly?.wape != null ? formatPercent(weekly.wape, true) : "—"}
              hint="Weekly-path WAPE on 26 origins"
              icon={CalendarRange}
              tone="default"
              loading={isLoading || diagnosticsQuery.isLoading}
            />
          </div>

          {/* Forecast chart */}
          <ChartCard
            title="Weekly collections and forecast"
            description="Observed weekly clearance, then the modelled path with its empirical band."
            loading={isLoading}
            footer="Weekly totals are authoritative. Daily figures are derived estimates allocated by historical weekday shares."
          >
            {data ? <CashFlowForecastChart data={data} currency={currency} /> : <Skeleton className="h-[320px] w-full" />}
          </ChartCard>

          {diagnostics?.available === false ? (
            <InfoNote variant="warning">
              Diagnostics are not exported on this server, so the comparison panels are hidden. Run{" "}
              <code>backend/scripts/export_cashflow_diagnostics.py</code> to enable them.
            </InfoNote>
          ) : null}

          {bundle ? (
            <>
              {/* Bake-off */}
              <Card>
                <CardHeader className="pb-3">
                  <SectionHeading
                    title="Model bake-off"
                    description="Six candidates on identical chronological folds. The selected row carries a green marker."
                  />
                  <div className="mt-2 flex gap-1">
                    {(["wape", "holdout"] as const).map((value) => (
                      <button
                        key={value}
                        onClick={() => setMetric(value)}
                        className={cn(
                          "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                          metric === value
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {value === "wape" ? "Validation" : "Holdout"}
                      </button>
                    ))}
                  </div>
                </CardHeader>
                <CardContent>
                  <ForecastBakeoff
                    candidates={candidates}
                    scope={scope}
                    scopes={(diagnostics?.scopes as DiagnosticsScope[]) ?? ["weekly", "h7", "h30", "h90"]}
                    onScopeChange={setScope}
                    metric={metric}
                  />
                </CardContent>
              </Card>

              {/* Decision */}
              <Card>
                <CardHeader className="pb-3">
                  <SectionHeading
                    title="Why this model won"
                    description="The rule was declared before any candidate was scored."
                  />
                </CardHeader>
                <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                  <div className="space-y-2">
                    <p className="flex flex-wrap items-center gap-2 text-sm leading-relaxed text-foreground">
                      A candidate had to beat the best baseline by
                      <Badge variant={improvement != null && improvement >= 0.1 ? "low" : "medium"}>
                        ≥10% relative WAPE
                      </Badge>
                      and win on at least four validation origins.
                    </p>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {decision?.reason ??
                        "Selection evidence is stored in the model metadata for this currency."}
                    </p>
                    <div className="grid grid-cols-3 gap-2 pt-1">
                      <Stat label="Baseline" value={decision?.baselineWape != null ? `${(decision.baselineWape * 100).toFixed(1)}%` : "—"} sub={decision?.baseline ?? ""} />
                      <Stat label="Selected" value={decision?.selectedWape != null ? `${(decision.selectedWape * 100).toFixed(1)}%` : "—"} sub={decision?.selected ?? ""} />
                      <Stat label="Improvement" value={improvement != null ? formatPercent(improvement, true) : "—"} sub="relative" good={improvement != null && improvement >= 0.1} />
                    </div>
                  </div>
                  <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3.5 text-xs">
                    <Row label="Selected model" value={MODEL_LABELS[decision?.selected ?? ""] ?? decision?.selected ?? "—"} />
                    <Row label="Kind" value={decision?.kind === "baseline" ? "Baseline shipped" : "Learned model"} />
                    <Row label="Currency" value={currency} />
                    <Row label="Horizon" value={`${horizon} days`} />
                    <Row label="Validation" value={data ? `${data.evaluation.validation.origins} origins` : "26 origins"} />
                    <Row label="Holdout" value={data ? `${data.evaluation.holdout.origins} origins` : "12 origins"} />
                    <Row
                      label="Holdout WAPE"
                      value={weekly?.holdoutWape != null ? `${(weekly.holdoutWape * 100).toFixed(1)}%` : "—"}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Stability + residuals */}
              <div className="grid gap-4 xl:grid-cols-2">
                <ChartCard
                  title="Stability across validation origins"
                  description="WAPE at each of the 26 origins. A flat line means the average is not hiding a lucky window."
                  loading={diagnosticsQuery.isLoading}
                  footer="Dashed line marks the 10% level for reference."
                >
                  <ForecastStability perOrigin={bundle.perOrigin} />
                </ChartCard>
                <ChartCard
                  title="Error by forecast step"
                  description="Median residual, 10–90% band and mean absolute error for the selected model."
                  loading={diagnosticsQuery.isLoading}
                  footer="Bands widen with horizon, as expected for a weekly model extrapolating further out."
                >
                  <ForecastResiduals
                    residuals={bundle.residuals[decision?.selected ?? ""] ?? []}
                    currency={currency}
                  />
                </ChartCard>
              </div>

              {/* Algorithms */}
              <Card>
                <CardHeader className="pb-3">
                  <SectionHeading
                    title="Algorithms compared"
                    description="Same target, same folds, different assumptions — and different failure modes."
                  />
                </CardHeader>
                <CardContent>
                  <AlgorithmCards candidates={candidates} currency={currency} />
                </CardContent>
              </Card>

              {/* Research */}
              {research ? (
                <Card>
                  <CardHeader className="pb-3">
                    <SectionHeading
                      title="Research experiments A–E"
                      description="What synthetic data was actually able to contribute."
                    />
                  </CardHeader>
                  <CardContent>
                    <ResearchPanel research={research} />
                  </CardContent>
                </Card>
              ) : null}

              {/* Pipeline */}
              <Card>
                <CardHeader className="pb-3">
                  <SectionHeading
                    title="How the forecast is produced"
                    description="Offline training, frozen artifact, read-only serving."
                  />
                </CardHeader>
                <CardContent>
                  <PipelineFlow
                    stages={[
                      { label: "Invoice extract", detail: "38k paid invoices, 2019–2020" },
                      { label: "Proxy target", detail: "Cleared amount by payment date" },
                      { label: "Weekly series", detail: "61 complete weeks per currency" },
                      { label: "Backtest", detail: "26 validation + 12 holdout origins" },
                      { label: "Selection", detail: "≥10% over baseline, ≥4 origins" },
                      { label: "Frozen artifact", detail: "Replay grid, no retraining" },
                    ]}
                  />
                </CardContent>
              </Card>

              {/* Daily estimates */}
              <Card>
                <CardHeader className="pb-3">
                  <SectionHeading
                    title="Derived daily estimates"
                    description="Weekly totals multiplied by historical weekday shares. Every row is an estimate."
                  />
                </CardHeader>
                <CardContent className="px-0 pb-2">
                  <div className="max-h-[320px] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Week</TableHead>
                          <TableHead className="text-right">Estimated</TableHead>
                          <TableHead className="text-right">Low</TableHead>
                          <TableHead className="text-right">High</TableHead>
                          <TableHead className="text-right">Type</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(data?.daily ?? []).map((day) => (
                          <TableRow key={day.date}>
                            <TableCell className="tabular">{formatShortDate(day.date)}</TableCell>
                            <TableCell className="tabular text-muted-foreground">
                              {formatShortDate(day.weekStart)}
                            </TableCell>
                            <TableCell className="text-right tabular">{formatCurrency(day.estimated, currency)}</TableCell>
                            <TableCell className="text-right tabular text-muted-foreground">
                              {formatCurrency(day.lower, currency)}
                            </TableCell>
                            <TableCell className="text-right tabular text-muted-foreground">
                              {formatCurrency(day.upper, currency)}
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge variant="muted">Estimate</Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              {/* Provenance */}
              <Card>
                <CardHeader className="pb-3">
                  <SectionHeading title="Provenance" description="What these numbers are, and are not." />
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Row label="Forecast origin" value={data ? formatDate(data.asOf) : "—"} />
                    <Row label="Trained through" value={data ? formatDate(data.trainedThrough) : "—"} />
                    <Row label="Data period" value={data ? `${data.dataPeriod.start} → ${data.dataPeriod.end}` : "—"} />
                    <Row label="Frequency" value="Weekly (W-MON)" />
                  </div>
                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      Weekday collection shares · {currency}
                    </p>
                    <div className="grid grid-cols-7 gap-1.5">
                      {(bundle.weekdayShares ?? []).map((share, index) => (
                        <div key={WEEKDAYS[index]} className="text-center">
                          <div className="flex h-16 items-end justify-center rounded bg-muted/40">
                            <div
                              className="w-full rounded-t bg-brand-accent/70"
                              style={{ height: `${Math.max(share * 100 * 3.2, 1.5)}%` }}
                            />
                          </div>
                          <p className="mt-1 text-[10px] text-muted-foreground">{WEEKDAYS[index]}</p>
                          <p className="text-[10px] tabular text-foreground">{(share * 100).toFixed(0)}%</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <InfoNote variant="warning">
                <strong>Invoice-clearance proxy.</strong> {data?.disclaimer}
              </InfoNote>

              <Card>
                <CardHeader className="pb-3">
                  <SectionHeading title="Assumptions and scope" description="Stated so the numbers cannot be over-read." />
                </CardHeader>
                <CardContent>
                  <ul className="grid gap-2.5 sm:grid-cols-2">
                    {(data?.assumptions ?? []).map((item) => (
                      <li
                        key={item}
                        className="flex gap-2.5 rounded-lg border border-border bg-muted/20 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground"
                      >
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-accent" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-4 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
                    The dataset ends on 2020-03-13, so this page shows a reproducible historical
                    simulation, not a live 2026 projection. Forecasting readiness is reported separately
                    from the three-model health gate.
                  </p>
                </CardContent>
              </Card>
            </>
          ) : diagnosticsQuery.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Card>
              <EmptyState
                icon={CalendarRange}
                title="Diagnostics unavailable"
                description="The comparison panels need the exported diagnostics file. The forecast above still works."
              />
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  good,
}: {
  label: string;
  value: string;
  sub?: string;
  good?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-2.5">
      <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className={cn("text-sm font-semibold tabular", good ? "text-risk-low" : "text-foreground")}>{value}</p>
      {sub ? <p className="truncate text-[10px] text-muted-foreground">{MODEL_LABELS[sub] ?? sub}</p> : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right font-medium tabular text-foreground">{value}</span>
    </div>
  );
}
