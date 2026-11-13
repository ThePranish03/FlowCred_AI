import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Download, Gauge, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { toast } from "sonner";
import { useRisk } from "@/api/queries";
import { PageHeader } from "@/components/common/page-header";
import { KpiCard } from "@/components/common/kpi-card";
import { ChartCard } from "@/components/common/chart-card";
import { InfoNote } from "@/components/common/notes";
import { ErrorState } from "@/components/common/states";
import { PageSkeleton } from "@/components/common/loading";
import { RiskBadge, StatusBadge } from "@/components/common/badges";
import { DataTable, type DataTableColumn } from "@/components/common/data-table";
import { Pagination } from "@/components/common/pagination";
import { SearchInput } from "@/components/common/search-input";
import { RiskTrendChart } from "@/components/charts/risk-trend-chart";
import { DonutChart, DonutLegend } from "@/components/charts/donut-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { downloadCsv } from "@/lib/csv";
import { RISK_CONFIG } from "@/lib/constants";
import {
  formatCurrency,
  formatDate,
  formatDelayShort,
  formatNumber,
  formatPercent,
  formatProbability,
} from "@/lib/format";
import type { RiskInvoiceSummary } from "@/types";

export default function PaymentRiskPage() {
  const { data, isLoading, isError, error, refetch } = useRisk();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 15;

  useEffect(() => {
    setPage(1);
  }, [search]);

  const filteredQueue = useMemo(() => {
    if (!data) return [];
    const term = search.trim().toLowerCase();
    if (!term) return data.queue;
    return data.queue.filter((row) =>
      `${row.id} ${row.customerId} ${row.customerName}`.toLowerCase().includes(term),
    );
  }, [data, search]);

  if (isLoading) return <PageSkeleton />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Risk summary could not be loaded"
        description={error instanceof Error ? error.message : "The risk endpoint did not respond."}
        onRetry={() => refetch()}
      />
    );
  }

  const { counts, bands } = data;
  const totalScored = counts.totalScored;
  const donutData = data.distribution.map((item) => ({
    name: `${RISK_CONFIG[item.band].label} (${RISK_CONFIG[item.band].range})`,
    value: item.count,
    color: RISK_CONFIG[item.band].hex,
  }));
  const pageStart = (page - 1) * pageSize;
  const queuePage = filteredQueue.slice(pageStart, pageStart + pageSize);

  function exportQueue() {
    downloadCsv(
      `flowcred-high-risk-queue-${new Date().toISOString().slice(0, 10)}.csv`,
      filteredQueue.map((row) => ({
        invoiceId: row.id,
        customerId: row.customerId,
        customerName: row.customerName,
        dueDate: row.dueDate,
        status: row.status ?? "",
        amount: row.amount,
        currency: row.currency,
        lateProbability: row.lateProbability,
        riskBand: row.riskBand,
        predictedDelayDays: row.predictedDelay ?? "",
      })),
      [
        { key: "invoiceId", label: "Invoice ID" },
        { key: "customerId", label: "Customer ID" },
        { key: "customerName", label: "Customer" },
        { key: "dueDate", label: "Due date" },
        { key: "status", label: "Status" },
        { key: "amount", label: "Amount" },
        { key: "currency", label: "Currency" },
        { key: "lateProbability", label: "Late probability" },
        { key: "riskBand", label: "Risk band" },
        { key: "predictedDelayDays", label: "Predicted delay (days)" },
      ],
    );
    toast.success(`Exported ${formatNumber(filteredQueue.length)} queue invoices`);
  }

  const queueColumns: DataTableColumn<RiskInvoiceSummary>[] = [
    {
      id: "id",
      header: "Invoice",
      cell: (row) => (
        <div>
          <p className="font-medium text-foreground">{row.id}</p>
          <p className="text-[11px] text-muted-foreground">{row.invoiceDate ?? "—"}</p>
        </div>
      ),
    },
    {
      id: "customer",
      header: "Customer",
      cell: (row) => (
        <div className="min-w-[150px]">
          <p className="truncate text-foreground">{row.customerName}</p>
          <Link
            to={`/customers/${row.customerId}`}
            onClick={(event) => event.stopPropagation()}
            className="text-[11px] text-brand-accent hover:underline"
          >
            {row.customerId}
          </Link>
        </div>
      ),
    },
    {
      id: "dueDate",
      header: "Due date",
      cell: (row) => <span className="whitespace-nowrap tabular">{formatDate(row.dueDate)}</span>,
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (row.status ? <StatusBadge status={row.status} /> : <span className="text-xs text-muted-foreground">—</span>),
    },
    {
      id: "probability",
      header: "Late probability",
      align: "right",
      cell: (row) => (
        <div className="min-w-[90px] text-right">
          <span className="font-semibold tabular text-foreground">{formatProbability(row.lateProbability)}</span>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-risk-high" style={{ width: `${row.lateProbability * 100}%` }} />
          </div>
        </div>
      ),
    },
    {
      id: "delay",
      header: "Predicted delay",
      align: "right",
      cell: (row) => <span className="tabular text-muted-foreground">{formatDelayShort(row.predictedDelay)}</span>,
    },
    {
      id: "amount",
      header: "Amount",
      align: "right",
      cell: (row) => <span className="tabular">{formatCurrency(row.amount, row.currency)}</span>,
    },
    {
      id: "band",
      header: "Band",
      cell: (row) => <RiskBadge band={row.riskBand} />,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Risk intelligence"
        title="Payment risk monitor"
        description="Invoices ranked by the XGBoost late-payment probability. Operational bands communicate severity; the 0.45 decision threshold determines the binary late flag."
        actions={
          <Button variant="outline" onClick={exportQueue} disabled={!filteredQueue.length}>
            <Download className="h-4 w-4" />
            Export queue
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Scored invoices"
          value={formatNumber(totalScored)}
          hint="Chronological evaluation window"
          icon={Gauge}
          tone="accent"
        />
        <KpiCard
          label="High band (≥ 70%)"
          value={formatNumber(counts.high)}
          hint={`${formatPercent((counts.high / Math.max(totalScored, 1)) * 100)} of scored invoices`}
          icon={ShieldAlert}
          tone="risk"
        />
        <KpiCard
          label="Medium band (30–70%)"
          value={formatNumber(counts.medium)}
          hint={`${formatPercent((counts.medium / Math.max(totalScored, 1)) * 100)} of scored invoices`}
          icon={ShieldQuestion}
          tone="warning"
        />
        <KpiCard
          label="Low band (< 30%)"
          value={formatNumber(counts.low)}
          hint={`${formatPercent((counts.low / Math.max(totalScored, 1)) * 100)} of scored invoices`}
          icon={ShieldCheck}
          tone="success"
        />
      </div>

      <InfoNote variant="warning">
        <strong>Open exposure is not represented in this demo.</strong> All {formatNumber(totalScored)} scored invoices in
        the evaluation window are marked paid in the source dataset, so open high-risk exposure is{" "}
        {formatCurrency(0, "USD")} and the open-invoice counts are zero. The queue ranks historical scored invoices by
        probability; it is not a current collections worklist. {data.currencyNote}
      </InfoNote>

      <div className="grid gap-4 lg:grid-cols-5">
        <ChartCard
          title="Risk trend across the scored window"
          description="Monthly scored volume, average probability and high-band count."
          className="lg:col-span-3"
          footer="Averages are computed from recorded probabilities, not forecasts."
        >
          <RiskTrendChart data={data.trend} />
        </ChartCard>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle>Band distribution</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Scored invoices assigned to each communication band.</p>
          </CardHeader>
          <CardContent>
            <DonutChart data={donutData} height={220} centerValue={formatNumber(totalScored)} centerLabel="scored invoices" />
            <div className="mt-4">
              <DonutLegend
                data={data.distribution.map((item) => ({
                  name: RISK_CONFIG[item.band].label,
                  value: item.count,
                  color: RISK_CONFIG[item.band].hex,
                }))}
              />
            </div>
            <div className="mt-4 space-y-2 border-t border-border/70 pt-3 text-[11px] text-muted-foreground">
              {(["low", "medium", "high"] as const).map((band) => (
                <div key={band} className="flex items-center justify-between gap-2">
                  <span>Open invoices · {bands[band].label}</span>
                  <span className="font-medium tabular text-foreground">
                    {formatNumber(band === "low" ? counts.openLow : band === "medium" ? counts.openMedium : counts.openHigh)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-3">
          <div>
            <CardTitle>High-risk queue</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Top {formatNumber(data.queue.length)} scored invoices in the High band, ordered by probability then amount.
            </p>
          </div>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Filter by invoice or customer…"
            className="w-full sm:w-72"
          />
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <DataTable
            data={queuePage}
            columns={queueColumns}
            getRowId={(row) => row.id}
            onRowClick={(row) => navigate(`/invoices/${row.id}`)}
            className="rounded-none border-0 border-t"
            emptyTitle="No queue invoices match"
            emptyDescription="Clear the filter to see the recorded high-risk queue."
          />
          <Pagination
            page={page}
            pageSize={pageSize}
            total={filteredQueue.length}
            totalPages={Math.max(1, Math.ceil(filteredQueue.length / pageSize))}
            onPageChange={setPage}
            itemLabel="queue invoices"
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle>Customers by average risk</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Customers with the highest mean late probability across their scored invoices.
            </p>
          </CardHeader>
          <CardContent className="space-y-1">
            {data.customerRisk.slice(0, 10).map((customer) => (
              <Link
                key={customer.id}
                to={`/customers/${customer.id}`}
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/60"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{customer.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {customer.id} · {formatNumber(customer.scoredInvoices)} scored · {formatNumber(customer.highRiskInvoices)} high
                    · latest {formatDate(customer.latestInvoice)}
                  </p>
                </div>
                <div className="flex w-28 shrink-0 flex-col items-end gap-1">
                  <span className="text-xs font-semibold tabular text-foreground">
                    {formatProbability(customer.avgProbability)}
                  </span>
                  <Progress
                    value={customer.avgProbability * 100}
                    className="h-1.5"
                    indicatorClassName={customer.avgProbability >= 0.7 ? "bg-risk-high" : customer.avgProbability >= 0.3 ? "bg-risk-medium" : "bg-risk-low"}
                  />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Threshold and bands</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">How to read a recorded probability.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-brand-accent/20 bg-primary-soft p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-accent">Decision threshold</p>
              <p className="mt-1 text-2xl font-semibold tabular text-brand-navy">
                {data.decisionThreshold.toFixed(2)}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-brand-navy/80">
                Probabilities at or above this cut-off are labelled late for classification metrics.
              </p>
            </div>
            <div className="space-y-3">
              {(["low", "medium", "high"] as const).map((key) => {
                const config = RISK_CONFIG[bands[key].label as keyof typeof RISK_CONFIG];
                return (
                  <div key={key} className="flex items-start gap-2.5">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: config.hex }} />
                    <div>
                      <p className="text-xs font-medium text-foreground">
                        {bands[key].label} · {config.range}
                      </p>
                      <p className="text-[11px] text-muted-foreground">{bands[key].description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="border-t border-border/70 pt-3 text-[11px] leading-relaxed text-muted-foreground">
              {data.thresholdExplanation}
            </p>
            <Badge variant="outline" className="whitespace-normal text-left font-normal">
              Historical model output · not a guarantee of payment behaviour
            </Badge>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
