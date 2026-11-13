import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, CalendarClock, Clock3, Hourglass, TimerReset } from "lucide-react";
import { useDelay } from "@/api/queries";
import { PageHeader } from "@/components/common/page-header";
import { KpiCard } from "@/components/common/kpi-card";
import { ChartCard } from "@/components/common/chart-card";
import { InfoNote } from "@/components/common/notes";
import { ErrorState } from "@/components/common/states";
import { PageSkeleton } from "@/components/common/loading";
import { DataTable, type DataTableColumn } from "@/components/common/data-table";
import { Pagination } from "@/components/common/pagination";
import { SearchInput } from "@/components/common/search-input";
import { DelayDistributionChart } from "@/components/charts/delay-distribution-chart";
import { DonutChart, DonutLegend } from "@/components/charts/donut-chart";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CHART_COLORS } from "@/lib/constants";
import {
  formatDelayShort,
  formatNumber,
  formatPercent,
  formatSignedDays,
} from "@/lib/format";
import type { DelayResponse } from "@/types";

type CustomerDelay = DelayResponse["customerDelay"][number];

export default function DelayPredictionsPage() {
  const { data, isLoading, isError, error, refetch } = useDelay();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 12;

  useEffect(() => {
    setPage(1);
  }, [search]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const term = search.trim().toLowerCase();
    if (!term) return data.customerDelay;
    return data.customerDelay.filter((row) => `${row.id} ${row.name}`.toLowerCase().includes(term));
  }, [data, search]);

  if (isLoading) return <PageSkeleton />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Delay summary could not be loaded"
        description={error instanceof Error ? error.message : "The delay endpoint did not respond."}
        onRetry={() => refetch()}
      />
    );
  }

  const composition = [
    { name: "Early (< −0.5 day)", value: data.counts.early, color: CHART_COLORS.teal },
    { name: "On time (±0.5 day)", value: data.counts.onTime, color: "#15803D" },
    { name: "Late (> +0.5 day)", value: data.counts.late, color: CHART_COLORS.red },
  ];
  const pageStart = (page - 1) * pageSize;
  const rows = filtered.slice(pageStart, pageStart + pageSize);

  const columns: DataTableColumn<CustomerDelay>[] = [
    {
      id: "customer",
      header: "Customer",
      cell: (row) => (
        <div className="min-w-[150px]">
          <p className="truncate font-medium text-foreground">{row.name}</p>
          <p className="text-[11px] text-muted-foreground">{row.id}</p>
        </div>
      ),
    },
    {
      id: "invoices",
      header: "Scored invoices",
      align: "right",
      cell: (row) => <span className="tabular">{formatNumber(row.invoices)}</span>,
    },
    {
      id: "avgPredicted",
      header: "Avg predicted delay",
      align: "right",
      cell: (row) => (
        <span
          className={
            row.avgPredictedDelay > 0.5
              ? "font-medium tabular text-risk-high"
              : row.avgPredictedDelay < -0.5
                ? "font-medium tabular text-brand-teal"
                : "tabular text-muted-foreground"
          }
        >
          {formatDelayShort(row.avgPredictedDelay)}
        </span>
      ),
    },
    {
      id: "maxPredicted",
      header: "Max predicted delay",
      align: "right",
      cell: (row) => <span className="tabular text-muted-foreground">{formatDelayShort(row.maxPredictedDelay)}</span>,
    },
    {
      id: "avgActual",
      header: "Avg actual delay",
      align: "right",
      cell: (row) => <span className="tabular text-muted-foreground">{formatDelayShort(row.avgActualDelay)}</span>,
    },
    {
      id: "interpretation",
      header: "Interpretation",
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.avgPredictedDelay > 0.5 ? "Predicted late" : row.avgPredictedDelay < -0.5 ? "Predicted early" : "Predicted on time"}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Delay intelligence"
        title="Payment delay predictions"
        description="Signed day estimates from the HistGradientBoosting regressor. Negative values mean early payment; positive values mean late payment. Values near zero indicate an on-time expectation."
        actions={
          <Button variant="outline" asChild>
            <Link to="/model-performance?model=payment-delay">
              View model evaluation
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Average predicted delay"
          value={formatDelayShort(data.averagePredictedDelay)}
          hint={formatSignedDays(data.averagePredictedDelay)}
          icon={CalendarClock}
          tone="accent"
        />
        <KpiCard
          label="Median predicted delay"
          value={formatDelayShort(data.medianPredictedDelay)}
          hint="Robust central estimate of the signed delay"
          icon={Hourglass}
          tone="teal"
        />
        <KpiCard
          label="Late predictions"
          value={formatPercent(data.latePercentage)}
          hint={`${formatNumber(data.counts.late)} invoices above +0.5 day`}
          icon={Clock3}
          tone="risk"
        />
        <KpiCard
          label="Average actual delay"
          value={formatDelayShort(data.averageActualDelay)}
          hint="Observed outcome for the same scored invoices"
          icon={TimerReset}
          tone="warning"
        />
      </div>

      <InfoNote>
        <strong>How to read a prediction.</strong> The regressor produces a whole-day estimate, not a payment date. The
        average prediction is close to zero, but the distribution is wide: {formatPercent(data.earlyPercentage)} of scored
        invoices are predicted early, {formatPercent(data.onTimePercentage)} on time and {formatPercent(data.latePercentage)}{" "}
        late. Use the sign and magnitude together, and treat the estimate as a planning input rather than a commitment.
      </InfoNote>

      <div className="grid gap-4 lg:grid-cols-5">
        <ChartCard
          title="Predicted delay distribution"
          description="Signed delay buckets across all scored invoices."
          className="lg:col-span-3"
          footer="Buckets use ±0.5 day as the on-time tolerance; values are point estimates."
        >
          <DelayDistributionChart data={data.distribution} height={300} />
        </ChartCard>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle>Payment timing mix</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Direction of the predicted delay.</p>
          </CardHeader>
          <CardContent>
            <DonutChart data={composition} centerValue={formatNumber(data.counts.scored)} centerLabel="scored invoices" height={210} />
            <div className="mt-4">
              <DonutLegend data={composition} />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Historical accuracy</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Recorded test-set error metrics for the delay regressor. Lower error is better; R² describes explained variance.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "MAE", value: data.metrics.MAE.toFixed(4), hint: "Mean absolute error (days)" },
              { label: "RMSE", value: data.metrics.RMSE.toFixed(4), hint: "Root mean squared error (days)" },
              { label: "R²", value: data.metrics.R2.toFixed(4), hint: "Variance explained on test data" },
              { label: "MedAE", value: data.metrics.MedAE.toFixed(4), hint: "Median absolute error (days)" },
            ].map((metric) => (
              <div key={metric.label} className="rounded-lg border border-border/80 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{metric.label}</p>
                <p className="mt-1 text-lg font-semibold tabular text-foreground">{metric.value}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{metric.hint}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Test rows: {formatNumber(data.metrics.testRows)} · {data.disclaimer}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-3">
          <div>
            <CardTitle>Customer delay ranking</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Highest average predicted delays among customers with scored invoices.
            </p>
          </div>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Filter by customer…"
            className="w-full sm:w-64"
          />
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <DataTable
            data={rows}
            columns={columns}
            getRowId={(row) => row.id}
            onRowClick={(row) => navigate(`/customers/${row.id}`)}
            className="rounded-none border-0 border-t"
            emptyTitle="No customers match"
            emptyDescription="Clear the filter to view the recorded delay ranking."
          />
          <Pagination
            page={page}
            pageSize={pageSize}
            total={filtered.length}
            totalPages={Math.max(1, Math.ceil(filtered.length / pageSize))}
            onPageChange={setPage}
            itemLabel="customers"
          />
        </CardContent>
      </Card>
    </div>
  );
}
