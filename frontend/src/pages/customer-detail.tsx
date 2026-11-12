import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Building2,
  CalendarClock,
  CircleDollarSign,
  Percent,
  ShieldAlert,
  Users,
} from "lucide-react";
import { useCustomer } from "@/api/queries";
import { PageHeader } from "@/components/common/page-header";
import { KpiCard } from "@/components/common/kpi-card";
import { ChartCard } from "@/components/common/chart-card";
import { InfoNote } from "@/components/common/notes";
import { ErrorState } from "@/components/common/states";
import { PageSkeleton } from "@/components/common/loading";
import { RiskBadge, StatusBadge } from "@/components/common/badges";
import { DataTable, type DataTableColumn } from "@/components/common/data-table";
import { InvoiceHistoryChart } from "@/components/charts/invoice-history-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CLUSTER_COLORS } from "@/lib/constants";
import {
  formatCurrency,
  formatDate,
  formatDelayShort,
  formatNumber,
  formatPercent,
  formatProbability,
} from "@/lib/format";
import type { Invoice } from "@/types";

function formatComparisonValue(feature: string, value: number) {
  if (feature === "latePaymentRatio") return formatPercent(value, true);
  if (feature === "avgPaymentDelay") return formatDelayShort(value);
  if (feature === "avgInvoiceAmount") return formatNumber(value, true);
  return value.toFixed(2);
}

export default function CustomerDetailPage() {
  const { customerId } = useParams<{ customerId: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError, error, refetch } = useCustomer(customerId);

  if (isLoading) return <PageSkeleton />;
  if (isError || !data) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/customers")}>
          <ArrowLeft className="h-4 w-4" />
          Customer directory
        </Button>
        <ErrorState
          title="Customer not available"
          description={error instanceof Error ? error.message : "This customer could not be loaded."}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const { customer, cluster, history, comparison, risk } = data;
  const clusterColor = CLUSTER_COLORS[customer.clusterId % CLUSTER_COLORS.length];
  const hasScores = (customer.scoredInvoices ?? 0) > 0;

  const invoiceColumns: DataTableColumn<Invoice>[] = [
    {
      id: "id",
      header: "Invoice",
      cell: (row) => (
        <div>
          <p className="font-medium text-foreground">{row.id}</p>
          <p className="text-[11px] text-muted-foreground">{row.paymentTerms}</p>
        </div>
      ),
    },
    {
      id: "invoiceDate",
      header: "Invoice date",
      cell: (row) => <span className="whitespace-nowrap tabular">{formatDate(row.invoiceDate)}</span>,
    },
    {
      id: "dueDate",
      header: "Due date",
      cell: (row) => <span className="whitespace-nowrap tabular">{formatDate(row.dueDate)}</span>,
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      id: "band",
      header: "Risk",
      cell: (row) => <RiskBadge band={row.riskBand} />,
    },
    {
      id: "probability",
      header: "Late probability",
      align: "right",
      cell: (row) => (
        <span className="tabular">{row.lateProbability == null ? "—" : formatProbability(row.lateProbability)}</span>
      ),
    },
    {
      id: "predicted",
      header: "Predicted delay",
      align: "right",
      cell: (row) => <span className="tabular text-muted-foreground">{formatDelayShort(row.predictedDelay)}</span>,
    },
    {
      id: "actual",
      header: "Actual delay",
      align: "right",
      cell: (row) => <span className="tabular text-muted-foreground">{formatDelayShort(row.delayDays)}</span>,
    },
    {
      id: "amount",
      header: "Amount",
      align: "right",
      cell: (row) => <span className="tabular">{formatCurrency(row.amount, row.currency)}</span>,
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 mb-2" onClick={() => navigate("/customers")}>
          <ArrowLeft className="h-4 w-4" />
          Customer directory
        </Button>
        <PageHeader
          eyebrow={`Customer 360 · ${customer.id}`}
          title={customer.name}
          description="A unified view of payment behaviour, outstanding value, model risk and segment context. Segment IDs are neutral; descriptive names are not yet approved."
          actions={
            <>
              <span
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
                style={{ borderColor: `${clusterColor}33`, backgroundColor: `${clusterColor}12`, color: clusterColor }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: clusterColor }} />
                Cluster {cluster.clusterId}
              </span>
              <Button variant="outline" size="sm" asChild>
                <Link to={`/customer-segments?cluster=${customer.clusterId}`}>
                  <Users className="h-4 w-4" />
                  Segment profile
                </Link>
              </Button>
            </>
          }
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total invoices"
          value={formatNumber(customer.totalInvoices)}
          hint={`${formatNumber(customer.activeMonths)} active months`}
          icon={Building2}
          tone="default"
        />
        <KpiCard
          label="Outstanding value"
          value={formatNumber(customer.outstandingAmount, true)}
          hint={`${formatNumber(customer.openInvoices)} open invoices · nominal`}
          icon={CircleDollarSign}
          tone="accent"
        />
        <KpiCard
          label="Late payment ratio"
          value={formatPercent(customer.latePaymentRatio, true)}
          hint={`${formatNumber(customer.lateInvoices)} late of ${formatNumber(customer.totalInvoices)} invoices`}
          icon={Percent}
          tone={customer.latePaymentRatio >= 0.5 ? "risk" : "warning"}
        />
        <KpiCard
          label="Average payment delay"
          value={formatDelayShort(customer.avgPaymentDelay)}
          hint={`Median ${formatDelayShort(customer.medianPaymentDelay)}`}
          icon={CalendarClock}
          tone="teal"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Risk snapshot</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Recorded scores for this customer in the evaluation window.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {hasScores ? (
              <>
                <div>
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <span className="text-xs text-muted-foreground">Average late probability</span>
                    <span className="text-lg font-semibold tabular text-foreground">
                      {formatProbability(risk.avgProbability)}
                    </span>
                  </div>
                  <Progress
                    value={(risk.avgProbability ?? 0) * 100}
                    className="h-2"
                    indicatorClassName={(risk.avgProbability ?? 0) >= 0.7 ? "bg-risk-high" : (risk.avgProbability ?? 0) >= 0.3 ? "bg-risk-medium" : "bg-risk-low"}
                  />
                </div>
                <dl className="space-y-2 text-xs">
                  {[
                    { label: "Scored invoices", value: formatNumber(risk.scoredInvoices) },
                    { label: "High-band invoices", value: formatNumber(risk.highRiskInvoices) },
                    { label: "Predicted late at 0.45", value: formatNumber(risk.predictedLateInvoices) },
                    { label: "Average predicted delay", value: formatDelayShort(risk.avgPredictedDelay) },
                    { label: "Outstanding value", value: formatNumber(risk.outstanding, true) },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-2">
                      <dt className="text-muted-foreground">{item.label}</dt>
                      <dd className="font-medium tabular text-foreground">{item.value}</dd>
                    </div>
                  ))}
                </dl>
                <Button variant="outline" size="sm" className="w-full" asChild>
                  <Link to="/payment-risk">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    Open risk monitor
                  </Link>
                </Button>
              </>
            ) : (
              <div className="space-y-3">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  This customer has no scored invoices in the chronological evaluation window, so no late-payment
                  probability is available.
                </p>
                <InfoNote>
                  Scores are produced only for the recorded test window. The interface does not impute or estimate a risk
                  score locally.
                </InfoNote>
              </div>
            )}
          </CardContent>
        </Card>

        <ChartCard
          title="Invoice history"
          description="Invoice amounts, actual delay and predicted delay over time."
          className="lg:col-span-2"
          footer="Amount bars are nominal and may mix USD and CAD. Delay lines use signed days; zero is on time."
        >
          {history.length ? (
            <InvoiceHistoryChart invoices={history.slice(0, 18)} />
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">No invoice history for this customer.</p>
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Customer vs segment vs global</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Descriptive comparison of behavioural features. Values are not model explanations.
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 pr-3 font-semibold">Feature</th>
                    <th className="pb-2 pr-3 text-right font-semibold">Customer</th>
                    <th className="pb-2 pr-3 text-right font-semibold">Segment avg</th>
                    <th className="pb-2 pr-3 text-right font-semibold">Global median</th>
                    <th className="pb-2 text-right font-semibold">Position</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.map((row) => {
                    const higher = row.customerValue > row.clusterValue;
                    const inLine = Math.abs(row.customerValue - row.clusterValue) <= Math.abs(row.clusterValue) * 0.01;
                    return (
                      <tr key={row.feature} className="border-b border-border/60 last:border-0">
                        <td className="py-2.5 pr-3 text-foreground">{row.label}</td>
                        <td className="py-2.5 pr-3 text-right font-medium tabular text-foreground">
                          {formatComparisonValue(row.feature, row.customerValue)}
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular text-muted-foreground">
                          {formatComparisonValue(row.feature, row.clusterValue)}
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular text-muted-foreground">
                          {formatComparisonValue(row.feature, row.globalMedian)}
                        </td>
                        <td className="py-2.5 text-right">
                          <Badge variant={inLine ? "muted" : higher ? "accent" : "outline"}>
                            {inLine ? "In line" : higher ? "Above" : "Below"}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Segment values are cluster means. Global values are medians across all customers.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Segment profile</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Cluster {cluster.clusterId} · {formatNumber(cluster.customers)} customers ({cluster.percentage.toFixed(2)}%)
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {cluster.isSmall ? (
              <InfoNote variant="warning">
                This cluster contains very few customers. Aggregate characteristics should be interpreted cautiously and
                are not representative of a broad population.
              </InfoNote>
            ) : null}
            <dl className="grid grid-cols-2 gap-4 text-xs">
              {[
                { label: "Average payment delay", value: formatDelayShort(cluster.avgPaymentDelay) },
                { label: "Average late ratio", value: formatPercent(cluster.avgLatePaymentRatio, true) },
                { label: "Average invoice amount", value: formatNumber(cluster.avgInvoiceAmount, true) },
                { label: "Average invoice frequency", value: cluster.avgInvoiceFrequency.toFixed(2) },
                { label: "Median invoice count", value: formatNumber(cluster.medianInvoiceCount) },
                { label: "Median lifetime", value: `${formatNumber(cluster.medianCustomerLifetimeDays)} days` },
              ].map((item) => (
                <div key={item.label}>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{item.label}</dt>
                  <dd className="mt-0.5 text-sm font-medium tabular text-foreground">{item.value}</dd>
                </div>
              ))}
            </dl>
            <div className="rounded-lg border border-border/80 bg-muted/30 p-3">
              <p className="text-[11px] text-muted-foreground">
                Last invoice {formatDate(customer.lastInvoiceDate)} · {formatNumber(customer.daysSinceLastInvoice)} days ago ·{" "}
                {formatNumber(customer.scoredInvoices ?? 0)} scored invoices
              </p>
            </div>
            <Button variant="outline" size="sm" className="w-full" asChild>
              <Link to={`/customer-segments?cluster=${cluster.clusterId}`}>
                <ArrowUpRight className="h-3.5 w-3.5" />
                Explore full segment
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle>Invoice ledger</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              All recorded invoices for this customer, newest first. Select a row for invoice-level intelligence.
            </p>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/invoices">
              Full ledger
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <DataTable
            data={history.slice(0, 20)}
            columns={invoiceColumns}
            getRowId={(row) => row.id}
            onRowClick={(row) => navigate(`/invoices/${row.id}`)}
            className="rounded-none border-0 border-t"
            emptyTitle="No invoices"
            emptyDescription="No invoices are recorded for this customer."
          />
        </CardContent>
      </Card>
    </div>
  );
}
