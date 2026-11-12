import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarClock,
  CircleDollarSign,
  Clock3,
  Info,
  LineChart,
  UserRound,
} from "lucide-react";
import { useInvoice } from "@/api/queries";
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
import { Separator } from "@/components/ui/separator";
import { RISK_CONFIG } from "@/lib/constants";
import {
  formatCurrency,
  formatDate,
  formatDelayShort,
  formatNumber,
  formatPercent,
  formatProbability,
} from "@/lib/format";
import type { Invoice } from "@/types";

export default function InvoiceDetailPage() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError, error, refetch } = useInvoice(invoiceId);

  if (isLoading) return <PageSkeleton />;
  if (isError || !data) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/invoices")}>
          <ArrowLeft className="h-4 w-4" />
          Back to invoices
        </Button>
        <ErrorState
          title="Invoice not available"
          description={error instanceof Error ? error.message : "This invoice could not be loaded."}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const { invoice, customer, cluster, history, context } = data;
  const bandConfig = invoice.riskBand ? RISK_CONFIG[invoice.riskBand] : null;
  const hasScore = invoice.lateProbability != null;

  const historyColumns: DataTableColumn<Invoice>[] = [
    {
      id: "id",
      header: "Invoice",
      cell: (row) => (
        <Link to={`/invoices/${row.id}`} className="font-medium text-brand-accent hover:underline">
          {row.id}
        </Link>
      ),
    },
    {
      id: "invoiceDate",
      header: "Invoice date",
      cell: (row) => <span className="tabular">{formatDate(row.invoiceDate)}</span>,
    },
    {
      id: "dueDate",
      header: "Due date",
      cell: (row) => <span className="tabular">{formatDate(row.dueDate)}</span>,
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => <StatusBadge status={row.status} />,
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
        <Button variant="ghost" size="sm" className="-ml-2 mb-2" onClick={() => navigate("/invoices")}>
          <ArrowLeft className="h-4 w-4" />
          Invoice ledger
        </Button>
        <PageHeader
          eyebrow={`Invoice · ${invoice.customerName}`}
          title={invoice.id}
          description={`Issued ${formatDate(invoice.invoiceDate)} · due ${formatDate(invoice.dueDate)} · terms ${invoice.paymentTerms}. Risk and delay figures are recorded model outputs for this invoice where available.`}
          actions={
            <>
              <StatusBadge status={invoice.status} />
              <RiskBadge band={invoice.riskBand} showRange />
              <Button variant="outline" size="sm" asChild>
                <Link to={`/customers/${customer.id}`}>
                  <UserRound className="h-4 w-4" />
                  Customer 360
                </Link>
              </Button>
            </>
          }
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Invoice amount"
          value={formatCurrency(invoice.amount, invoice.currency)}
          hint={`${invoice.currency} · nominal value`}
          icon={CircleDollarSign}
          tone="default"
        />
        <KpiCard
          label="Late probability"
          value={hasScore ? formatProbability(invoice.lateProbability) : "Not scored"}
          hint={hasScore ? `Operational band: ${invoice.riskBand}` : "No classifier output recorded"}
          icon={Info}
          tone={invoice.riskBand === "High" ? "risk" : invoice.riskBand === "Medium" ? "warning" : "success"}
        />
        <KpiCard
          label="Predicted delay"
          value={formatDelayShort(invoice.predictedDelay)}
          hint="Signed regression estimate in days"
          icon={CalendarClock}
          tone="teal"
        />
        <KpiCard
          label={invoice.status === "paid" ? "Actual delay" : "Payment date"}
          value={
            invoice.status === "paid"
              ? formatDelayShort(invoice.delayDays)
              : invoice.paymentDate
                ? formatDate(invoice.paymentDate)
                : "Outstanding"
          }
          hint={
            invoice.status === "paid"
              ? `Paid ${formatDate(invoice.paymentDate)}`
              : "No payment date recorded in the source data"
          }
          icon={Clock3}
          tone="accent"
        />
      </div>

      {!hasScore ? (
        <InfoNote>
          <strong>No model score for this invoice.</strong> The late-payment and delay models were applied to a
          chronological test window only, so invoices outside that window remain unscored. Nothing is approximated in the
          browser. Connect the inference API to score new invoices on demand.
        </InfoNote>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle>Invoice details</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Recorded values from the cleaned accounts-receivable dataset.</p>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              {[
                { label: "Invoice ID", value: invoice.id },
                { label: "Customer", value: invoice.customerName },
                { label: "Customer ID", value: invoice.customerId },
                { label: "Payment terms", value: invoice.paymentTerms },
                { label: "Invoice date", value: formatDate(invoice.invoiceDate) },
                { label: "Due date", value: formatDate(invoice.dueDate) },
                { label: "Payment date", value: invoice.paymentDate ? formatDate(invoice.paymentDate) : "Not paid" },
                { label: "Status", value: <StatusBadge status={invoice.status} /> },
                {
                  label: "Contract term length",
                  value: `${formatNumber(context.daysUntilDue)} days`,
                },
                {
                  label: "Actual delay",
                  value: invoice.delayDays == null ? "—" : formatDelayShort(invoice.delayDays),
                },
                { label: "Nominal amount", value: formatCurrency(invoice.amount, invoice.currency) },
                { label: "Currency", value: invoice.currency },
              ].map((item) => (
                <div key={item.label} className="min-w-0">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {item.label}
                  </dt>
                  <dd className="mt-1 truncate text-sm text-foreground">{item.value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Score interpretation</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Probability bands do not alter the binary decision threshold.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {hasScore ? (
              <>
                <div>
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <span className="text-xs text-muted-foreground">Late probability</span>
                    <span className="text-lg font-semibold tabular text-foreground">
                      {formatProbability(invoice.lateProbability)}
                    </span>
                  </div>
                  <Progress
                    value={invoice.lateProbability! * 100}
                    className="h-2"
                    indicatorClassName={
                      invoice.riskBand === "High"
                        ? "bg-risk-high"
                        : invoice.riskBand === "Medium"
                          ? "bg-risk-medium"
                          : "bg-risk-low"
                    }
                  />
                  <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                    <span>0%</span>
                    <span>30%</span>
                    <span>70%</span>
                    <span>100%</span>
                  </div>
                </div>
                <Separator />
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Operational band</span>
                    <RiskBadge band={invoice.riskBand} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Binary late flag at 0.45</span>
                    <Badge variant={invoice.lateProbability! >= 0.45 ? "high" : "low"}>
                      {invoice.lateProbability! >= 0.45 ? "Predicted late" : "Predicted on time"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Band range</span>
                    <span className="tabular text-foreground">{bandConfig?.range ?? "—"}</span>
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  A high band does not by itself change the model&apos;s late/on-time decision. Bands are communication
                  ranges applied to the same probability.
                </p>
              </>
            ) : (
              <p className="text-sm leading-relaxed text-muted-foreground">
                This invoice has no recorded late-payment probability. Score it through the inference endpoint once the
                backend is connected; the interface will not estimate a score locally.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Customer context</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">History used as model inputs, not post-hoc explanations.</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <Link
              to={`/customers/${customer.id}`}
              className="flex items-center justify-between gap-2 rounded-lg border border-border/80 p-3 transition-colors hover:bg-muted/50"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{customer.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {customer.id} · Cluster {cluster.clusterId}
                </p>
              </div>
              <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
            <dl className="space-y-2 text-xs">
              {[
                { label: "Invoices on record", value: formatNumber(context.previousInvoiceCount) },
                { label: "Previous average delay", value: formatDelayShort(context.previousAvgDelay) },
                { label: "Previous median delay", value: formatDelayShort(context.previousMedianDelay) },
                { label: "Previous late ratio", value: formatPercent(context.previousLateRatio, true) },
                { label: "Segment size", value: `${formatNumber(cluster.customers)} customers` },
                { label: "Segment late ratio", value: formatPercent(cluster.avgLatePaymentRatio, true) },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">{item.label}</dt>
                  <dd className="font-medium tabular text-foreground">{item.value}</dd>
                </div>
              ))}
            </dl>
            <InfoNote variant="info">
              These customer features were available before the invoice was scored. They support understanding — they are
              not per-invoice SHAP contributions.
            </InfoNote>
          </CardContent>
        </Card>

        <ChartCard
          title="Customer invoice history"
          description="Amount, actual delay and predicted delay across this customer's invoices."
          className="lg:col-span-2"
          footer="Amounts are nominal and may mix USD and CAD; delay values are signed days."
        >
          <InvoiceHistoryChart invoices={history} />
        </ChartCard>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle>Related invoices</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Most recent invoices for {customer.name}. Select any invoice to open its detail view.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to={`/customers/${customer.id}`}>
              <LineChart className="h-3.5 w-3.5" />
              Customer profile
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <DataTable
            data={history}
            columns={historyColumns}
            getRowId={(row) => row.id}
            onRowClick={(row) => navigate(`/invoices/${row.id}`)}
            className="rounded-none border-0 border-t"
            emptyTitle="No related invoices"
            emptyDescription="No other invoices were found for this customer."
          />
        </CardContent>
      </Card>
    </div>
  );
}
