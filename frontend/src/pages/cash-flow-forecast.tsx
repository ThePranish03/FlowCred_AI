import { useMemo, useState } from "react";
import {
  CalendarRange,
  CircleDollarSign,
  Gauge,
  LineChart as LineChartIcon,
  TriangleAlert,
} from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { ChartCard } from "@/components/common/chart-card";
import { KpiCard } from "@/components/common/kpi-card";
import { InfoNote, SectionHeading } from "@/components/common/notes";
import { EmptyState, ErrorState } from "@/components/common/states";
import { CashFlowForecastChart } from "@/components/charts/cash-flow-forecast-chart";
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
import { useCashFlowForecast, useCashFlowHealth } from "@/api/queries";
import { formatCurrency, formatDate, formatPercent, formatShortDate } from "@/lib/format";
import { API_MODE } from "@/lib/constants";

const HORIZONS = [7, 30, 90] as const;
const ALGORITHM_LABELS: Record<string, string> = {
  seasonal_naive: "Seasonal-naive baseline",
  due_date_schedule: "Due-date schedule baseline",
  xgboost_weekly: "XGBoost (weekly)",
  xgboost_daily: "XGBoost (daily → weekly)",
  ets: "Exponential smoothing (damped trend)",
  arima: "ARIMA",
};

function algorithmLabel(value: string | null | undefined) {
  if (!value) return "—";
  return ALGORITHM_LABELS[value] ?? value;
}

interface ApiFailure {
  status?: number;
  message?: string;
}

/** Turn the API client's failure shape into an actionable message. */
function describeError(error: unknown): { message: string; unauthorised: boolean } {
  const failure = (error ?? {}) as ApiFailure;
  if (failure.status === 401) {
    return {
      message:
        "You are not signed in, or your session expired. Sign in again to load the forecast — the model itself is fine.",
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
  if (failure.status === 403) {
    return { message: "Your account role does not have access to this forecast endpoint.", unauthorised: false };
  }
  if (!failure.status) {
    return {
      message:
        failure.message ??
        "The forecast service could not be reached. Check the connection and retry.",
      unauthorised: false,
    };
  }
  return {
    message: failure.message ?? "The forecast could not be loaded.",
    unauthorised: false,
  };
}

export default function CashFlowForecastPage() {
  const [currency, setCurrency] = useState<"USD" | "CAD">("USD");
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>(30);

  const { data, isLoading, isError, error, refetch } = useCashFlowForecast({ currency, horizon });
  const health = useCashFlowHealth();
  const selectedModelStatus = health.data?.models.find((model) => model.currency === currency);

  const weeklyRows = useMemo(() => data?.weekly ?? [], [data]);
  const dailyRows = useMemo(() => data?.daily ?? [], [data]);
  const comparison = useMemo(() => data?.comparison ?? [], [data]);

  const horizonLabel = `${horizon} days`;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Workspace"
        title="Cash Flow Forecast"
        description="Replay historical invoice-clearance estimates built from past payment patterns. USD and CAD stay separate, with uncertainty ranges shown."
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge variant={API_MODE === "demo" ? "accent" : selectedModelStatus?.available ? "low" : "high"}>
              {API_MODE === "demo" ? "Demo fixture" : health.isLoading ? "Checking model" : selectedModelStatus?.available ? "Model artifact loaded" : "Model unavailable"}
            </Badge>
            <Badge variant="medium">Historical simulation</Badge>
          </div>
        }
      />

      <InfoNote variant="warning">
        Historical simulation: this model was trained on invoice data ending 13 March 2020. Results are not a current
        forecast based on your latest business transactions.{" "}
        {API_MODE === "demo"
          ? "Demo mode displays a recorded fixture, not a live model request."
          : "Live mode requests a saved-model replay from the backend; the result is still historical."}
      </InfoNote>

      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="grid flex-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Currency
              </label>
              <Select value={currency} onChange={(event) => setCurrency(event.target.value as "USD" | "CAD")}>
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
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Forecast origin
              </p>
              <p className="flex h-10 items-center rounded-lg border border-border bg-muted/30 px-3 text-sm text-foreground tabular">
                {data ? formatDate(data.asOf) : "—"}
              </p>
            </div>
          </div>
          {data ? (
            <div className="text-xs leading-relaxed text-muted-foreground sm:text-right">
              <p>
                Trained through <span className="font-medium text-foreground">{formatDate(data.trainedThrough)}</span>
              </p>
              <p>
                Model <span className="font-medium text-foreground">{algorithmLabel(data.model.algorithm)}</span> · v
                {data.model.version ?? "—"}
              </p>
            </div>
          ) : null}
        </div>
      </Card>

      {isError ? (
        <Card>
          <ErrorState
            title={describeError(error).unauthorised ? "Sign-in required" : "Forecast unavailable"}
            description={describeError(error).message}
            onRetry={() => refetch()}
          />
          {describeError(error).unauthorised ? (
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
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Simulated invoice clearances"
              value={formatCurrency(data?.totals.predicted, currency, true)}
              hint={data ? `Origin ${formatShortDate(data.asOf)}` : undefined}
              icon={CircleDollarSign}
              tone="accent"
              loading={isLoading}
            />
            <KpiCard
              label="Lower estimate"
              value={formatCurrency(data?.totals.lower, currency, true)}
              hint="Empirical backtest interval · not a guarantee"
              icon={TriangleAlert}
              tone="warning"
              loading={isLoading}
            />
            <KpiCard
              label="Upper estimate"
              value={formatCurrency(data?.totals.upper, currency, true)}
              hint="Empirical backtest interval · not a guarantee"
              icon={Gauge}
              tone="teal"
              loading={isLoading}
            />
            <KpiCard
              label="Weekly blocks"
              value={data ? String(weeklyRows.length) : "—"}
              hint="Weekly totals are authoritative"
              icon={CalendarRange}
              loading={isLoading}
            />
          </div>

          <ChartCard
            title="Observed history and simulated path"
            description="Historical weekly clearance is shown separately from the saved-model replay. The shaded band is an empirical backtest interval."
            loading={isLoading}
            footer={
              data
                ? `Weekly frequency is authoritative. Daily values on this page are derived estimates allocated by historical weekday shares, not independently trained daily forecasts.`
                : undefined
            }
          >
            {data ? (
              <CashFlowForecastChart data={data} currency={currency} />
            ) : (
              <Skeleton className="h-[320px] w-full" />
            )}
          </ChartCard>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)]">
            <Card>
              <CardHeader className="pb-3">
                <SectionHeading
                  title="Model comparison"
                  description={`Validation uses ${data?.evaluation.validation.origins ?? 26} rolling origins; holdout WAPE is from a separate ${data?.evaluation.holdout.origins ?? 12}-origin set. Lower WAPE is better.`}
                />
              </CardHeader>
              <CardContent className="px-0 pb-2">
                {isLoading ? (
                  <Skeleton className="mx-5 h-40 w-auto" />
                ) : comparison.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Approach</TableHead>
                        <TableHead className="text-right">MAE</TableHead>
                        <TableHead className="text-right">RMSE</TableHead>
                        <TableHead className="text-right">WAPE</TableHead>
                        <TableHead className="text-right">Validation</TableHead>
                        <TableHead className="text-right">Holdout WAPE</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {comparison.map((row) => {
                        const selected = data?.model.algorithm === row.model;
                        return (
                          <TableRow key={row.model}>
                            <TableCell>
                              <span className="flex items-center gap-2">
                                {algorithmLabel(row.model)}
                                {selected ? <Badge variant="low">Selected</Badge> : null}
                              </span>
                            </TableCell>
                            <TableCell className="text-right tabular">
                              {formatCurrency(row.mae, currency, true)}
                            </TableCell>
                            <TableCell className="text-right tabular">
                              {formatCurrency(row.rmse, currency, true)}
                            </TableCell>
                            <TableCell className="text-right tabular">
                              {formatPercent(row.wape, true)}
                            </TableCell>
                            <TableCell className="text-right tabular">
                              {row.folds ? `${row.folds} origins` : "—"}
                              {row.firstAsOf && row.lastAsOf ? <span className="mt-0.5 block text-[10px] text-muted-foreground">{row.firstAsOf} – {row.lastAsOf}</span> : null}
                            </TableCell>
                            <TableCell className="text-right tabular">{formatPercent(row.holdoutWape, true)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <EmptyState
                    icon={LineChartIcon}
                    title="No comparison rows"
                    description="Backtest metrics are published with the forecast artifact."
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <SectionHeading title="Selected model" description="Chosen by a pre-declared validation rule." />
              </CardHeader>
              <CardContent className="space-y-3 text-xs leading-relaxed text-muted-foreground">
                <div className="flex items-center justify-between gap-3">
                  <span>Algorithm</span>
                  <span className="font-medium text-foreground">{algorithmLabel(data?.model.algorithm)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Currency</span>
                  <span className="font-medium text-foreground">{currency}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Horizon</span>
                  <span className="font-medium text-foreground">{horizonLabel}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Forecast origin</span>
                  <span className="font-medium text-foreground tabular">{data ? data.asOf : "—"}</span>
                </div>
                <p className="border-t border-border pt-3">
                  {data?.model.selection ?? "Selection evidence is stored in the model metadata."}
                </p>
                {data ? <p>Training window: {data.dataPeriod.start} – {data.dataPeriod.end} · {data.evaluation.trainingWeeklyObservations} complete weekly observations.</p> : null}
                {data ? <p>Validation: {data.evaluation.validation.origins} origins ({data.evaluation.validation.from} – {data.evaluation.validation.through}). Untouched holdout: {data.evaluation.holdout.origins} origins ({data.evaluation.holdout.from} – {data.evaluation.holdout.through}).</p> : null}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <SectionHeading
                title="Derived daily estimates"
                description="Each value is a weekly total multiplied by the historical weekday share. All rows are estimates."
              />
            </CardHeader>
            <CardContent className="px-0 pb-2">
              {isLoading ? (
                <Skeleton className="mx-5 h-48 w-auto" />
              ) : (
                <div className="max-h-[360px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Week starting</TableHead>
                        <TableHead className="text-right">Estimated</TableHead>
                        <TableHead className="text-right">Low</TableHead>
                        <TableHead className="text-right">High</TableHead>
                        <TableHead className="text-right">Type</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dailyRows.map((day) => (
                        <TableRow key={day.date}>
                          <TableCell className="tabular">{formatShortDate(day.date)}</TableCell>
                          <TableCell className="tabular text-muted-foreground">
                            {formatShortDate(day.weekStart)}
                          </TableCell>
                          <TableCell className="text-right tabular">
                            {formatCurrency(day.estimated, currency)}
                          </TableCell>
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
              )}
            </CardContent>
          </Card>

          <InfoNote variant="warning">
            <strong>Invoice-clearance proxy.</strong> Forecasts estimate invoice clearances from historical paid-invoice
            amounts and payment dates. They are not verified bank receipts.
            {data?.disclaimer ? <span className="mt-1.5 block">{data.disclaimer}</span> : null}
          </InfoNote>

          <Card>
            <CardHeader className="pb-3">
              <SectionHeading
                title="Assumptions and scope"
                description="Stated so the numbers cannot be read as more than they are."
              />
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
              <div className="mt-4 rounded-lg border border-border bg-muted/20 p-3.5 text-xs leading-relaxed text-muted-foreground">
                <h3 className="font-semibold text-foreground">How to interpret this forecast</h3>
                <ul className="mt-2 list-disc space-y-1.5 pl-4">
                  <li>It estimates invoice clearances from historical paid-invoice patterns; it does not verify money received by a bank.</li>
                  <li>Weekly predictions are the primary model output. Daily values are derived estimates and are labelled as such.</li>
                  <li>The interval is an empirical range from backtest errors, not a guarantee.</li>
                  <li>USD and CAD models run separately. No foreign-exchange conversion is applied.</li>
                  <li>The 61 complete weekly observations cover 2019-01-03 through 2020-03-13; this is not a live 2026 forecast.</li>
                </ul>
              </div>
              <p className="mt-4 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
                The dataset ends on 2020-03-13. This page shows a reproducible historical forecast, not a live 2026
                projection. The core three-model health gate is reported separately from forecasting readiness.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
