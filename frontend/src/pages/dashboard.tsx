import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Bot,
  CalendarClock,
  CircleDollarSign,
  Download,
  Layers,
  RefreshCw,
  ShieldAlert,
  Users,
} from "lucide-react";
import { useDashboard } from "@/api/queries";
import { PageHeader } from "@/components/common/page-header";
import { KpiCard } from "@/components/common/kpi-card";
import { ChartCard } from "@/components/common/chart-card";
import { InfoNote } from "@/components/common/notes";
import { ErrorState } from "@/components/common/states";
import { PageSkeleton } from "@/components/common/loading";
import { RiskBadge } from "@/components/common/badges";
import { DataTable, type DataTableColumn } from "@/components/common/data-table";
import { MonthlyTrendChart } from "@/components/charts/monthly-trend-chart";
import { DonutChart, DonutLegend } from "@/components/charts/donut-chart";
import { DelayDistributionChart } from "@/components/charts/delay-distribution-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CHART_COLORS, RISK_CONFIG } from "@/lib/constants";
import {
  formatCurrency,
  formatDate,
  formatDelayShort,
  formatNumber,
  formatPercent,
  formatProbability,
} from "@/lib/format";
import type { RiskInvoiceSummary } from "@/types";

export default function DashboardPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useDashboard();

  if (isLoading) return <PageSkeleton />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Dashboard data could not be loaded"
        description={error instanceof Error ? error.message : "The summary endpoint did not respond."}
        onRetry={() => refetch()}
      />
    );
  }

  const { kpis } = data;
  const riskDonut = data.riskDistribution.map((item) => ({
    name: RISK_CONFIG[item.band].label,
    value: item.count,
    color: RISK_CONFIG[item.band].hex,
  }));
  const statusDonut = data.statusDistribution.map((item) => ({
    name: item.status,
    value: item.count,
    color: item.status === "Paid" ? CHART_COLORS.teal : CHART_COLORS.accent,
  }));

  const riskColumns: DataTableColumn<RiskInvoiceSummary>[] = [
    {
      id: "id",
      header: "Invoice",
      cell: (row) => (
        <div>
          <p className="font-medium text-foreground">{row.id}</p>
          <p className="text-[11px] text-muted-foreground">{row.customerName}</p>
        </div>
      ),
    },
    {
      id: "dueDate",
      header: "Due date",
      cell: (row) => <span className="tabular">{formatDate(row.dueDate)}</span>,
    },
    {
      id: "probability",
      header: "Late probability",
      align: "right",
      cell: (row) => (
        <span className="font-medium tabular text-foreground">{formatProbability(row.lateProbability)}</span>
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
    <div className="space-y-6">
      <PageHeader
        eyebrow="Executive overview"
        title="Receivables intelligence at a glance"
        description="A summary of invoice performance, late-payment risk and predicted payment timing drawn from the trained FlowCred models. All figures reference recorded model artifacts — nothing is simulated in the browser."
        actions={
          <>
            <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              Refresh
            </Button>
            <Button asChild>
              <Link to="/reports">
                <Download className="h-4 w-4" />
                Generate report
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total outstanding"
          value={formatNumber(kpis.totalOutstandingAmount, true)}
          hint={`${formatNumber(kpis.openInvoices)} open invoices · nominal USD/CAD`}
          icon={CircleDollarSign}
          tone="accent"
        />
        <KpiCard
          label="High-risk invoices"
          value={formatNumber(kpis.highRiskInvoices)}
          hint={`${formatPercent((kpis.highRiskInvoices / Math.max(kpis.scoredInvoices, 1)) * 100)} of ${formatNumber(kpis.scoredInvoices)} scored invoices`}
          icon={ShieldAlert}
          tone="risk"
        />
        <KpiCard
          label="Average predicted delay"
          value={`${kpis.averagePredictedDelay > 0 ? "+" : ""}${kpis.averagePredictedDelay.toFixed(2)} days`}
          hint="Signed estimate across the scored window"
          icon={CalendarClock}
          tone="warning"
        />
        <KpiCard
          label="Customers analysed"
          value={formatNumber(kpis.customersAnalysed)}
          hint={`${formatNumber(kpis.totalInvoices)} invoices · 6 behavioural segments`}
          icon={Users}
          tone="teal"
        />
      </div>

      <InfoNote>
        <strong>Reading the risk figures.</strong> The scored evaluation window ({formatDate(data.dataWindow.scoredStart)} to{" "}
        {formatDate(data.dataWindow.scoredEnd)}) contains paid invoices in the source dataset, so open high-risk exposure
        is {formatCurrency(0, "USD")}. Risk distributions describe scored historical invoices, not current open AR.{" "}
        {data.currencyNote}
      </InfoNote>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          title="Invoiced value and volume"
          description="Monthly invoice count and nominal invoice value across the full dataset."
          className="lg:col-span-2"
          footer={data.currencyNote}
        >
          <MonthlyTrendChart data={data.monthlyTrends} />
        </ChartCard>

        <ChartCard
          title="Late-payment risk mix"
          description="Scored invoices by operational risk band."
          footer={`Bands: Low < 30% · Medium 30–70% · High ≥ 70%. Decision threshold is 0.45.`}
        >
          <DonutChart data={riskDonut} centerValue={formatNumber(kpis.scoredInvoices)} centerLabel="scored invoices" />
          <div className="mt-4">
            <DonutLegend data={riskDonut} />
          </div>
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          title="Predicted payment timing"
          description="Distribution of signed delay estimates: negative values mean early payment."
          className="lg:col-span-2"
          footer="Predictions are point estimates from the delay regressor; they are not guaranteed payment dates."
        >
          <DelayDistributionChart data={data.delayDistribution} />
        </ChartCard>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Model status</CardTitle>
            <p className="text-xs text-muted-foreground">Artifacts available to this workspace</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.modelStatus.map((model) => (
              <div key={model.id} className="rounded-lg border border-border/80 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{model.name}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{model.algorithm}</p>
                  </div>
                  <Badge variant={model.status === "available" ? "low" : "muted"}>
                    {model.status === "available" ? "Available" : "Planned"}
                  </Badge>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
                  <span className="truncate text-muted-foreground">{model.version ?? "No model trained"}</span>
                  {model.primaryMetric ? (
                    <span className="shrink-0 font-medium tabular text-foreground">
                      {model.primaryMetric.label} {model.primaryMetric.value}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" className="w-full" asChild>
              <Link to="/model-performance">
                <Bot className="h-3.5 w-3.5" />
                Open model evaluation
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle>Recent high-risk invoices</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Highest recorded late-payment probabilities in the scored window.
              </p>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/payment-risk">
                View risk monitor
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <DataTable
              data={data.recentHighRiskInvoices.slice(0, 6)}
              columns={riskColumns}
              getRowId={(row) => row.id}
              className="rounded-none border-0 border-t"
              skeletonRows={4}
              emptyTitle="No high-risk invoices recorded"
              emptyDescription="No invoice in the scored window was assigned the High band."
            />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Payment status</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">All invoices in the cleaned dataset</p>
            </CardHeader>
            <CardContent>
              <DonutChart data={statusDonut} height={190} innerRadius={50} outerRadius={74} centerValue={formatNumber(kpis.totalInvoices)} centerLabel="invoices" />
              <div className="mt-3">
                <DonutLegend data={statusDonut} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Customer segments</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">K-Means allocation across {formatNumber(kpis.customersAnalysed)} customers</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.segmentDistribution.map((segment, index) => (
                <div key={segment.clusterId}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: [CHART_COLORS.navy, CHART_COLORS.accent, CHART_COLORS.teal, CHART_COLORS.sky, CHART_COLORS.slate, "#C2A46B"][index % 6] }}
                      />
                      Cluster {segment.clusterId}
                    </span>
                    <span className="font-medium tabular text-foreground">
                      {formatNumber(segment.customers)}
                      <span className="ml-1.5 font-normal text-muted-foreground">{segment.percentage.toFixed(1)}%</span>
                    </span>
                  </div>
                  <Progress
                    value={segment.percentage}
                    className="h-1.5"
                    indicatorClassName={index === 0 ? "bg-brand-navy" : "bg-brand-accent"}
                  />
                </div>
              ))}
              <Button variant="ghost" size="sm" className="w-full" asChild>
                <Link to="/customer-segments">
                  <Layers className="h-3.5 w-3.5" />
                  Explore segments
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
          <CardHeader className="pb-3">
            <CardTitle>Recently analysed customers</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Customers with the most recent scored invoices and their average late probability.
            </p>
          </CardHeader>
          <CardContent className="space-y-1">
            {data.recentlyAnalysedCustomers.map((customer) => (
              <Link
                key={customer.id}
                to={`/customers/${customer.id}`}
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/60"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{customer.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {customer.id} · {formatNumber(customer.scoredInvoices)} scored · last {formatDate(customer.lastScoredInvoice)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="w-24">
                    <Progress value={customer.avgProbability * 100} className="h-1.5" indicatorClassName={customer.avgProbability >= 0.7 ? "bg-risk-high" : customer.avgProbability >= 0.3 ? "bg-risk-medium" : "bg-risk-low"} />
                    <p className="mt-1 text-right text-[10px] tabular text-muted-foreground">
                      {formatProbability(customer.avgProbability)} avg
                    </p>
                  </div>
                  <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              </Link>
            ))}
          </CardContent>
      </Card>
    </div>
  );
}
