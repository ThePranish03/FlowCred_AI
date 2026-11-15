import { useEffect, useMemo, useState, type ElementType } from "react";
import {
  AlertTriangle,
  Bot,
  CalendarRange,
  Clock3,
  Download,
  FileSpreadsheet,
  FileText,
  ListChecks,
  Sparkles,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api";
import { PageHeader } from "@/components/common/page-header";
import { InfoNote, SectionHeading } from "@/components/common/notes";
import { EmptyState } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { downloadCsv } from "@/lib/csv";
import { downloadPdf } from "@/lib/pdf";
import {
  formatDate,
  formatDelayShort,
  formatNumber,
  formatProbability,
  formatSignedDays,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { GeneratedReport, Invoice, ReportType } from "@/types";

interface ReportTypeOption {
  id: ReportType;
  title: string;
  description: string;
  icon: ElementType;
  usesInvoiceFilters: boolean;
}

const TYPE_OPTIONS: ReportTypeOption[] = [
  {
    id: "late-risk",
    title: "Late-payment risk register",
    description: "Scored invoices ranked by probability with risk bands and delay estimates.",
    icon: AlertTriangle,
    usesInvoiceFilters: true,
  },
  {
    id: "payment-delay",
    title: "Payment-delay forecast",
    description: "Signed delay predictions with actual outcomes where recorded.",
    icon: Clock3,
    usesInvoiceFilters: true,
  },
  {
    id: "segmentation",
    title: "Customer segment profile",
    description: "Cluster assignments and behavioural metrics for every analysed customer.",
    icon: Users,
    usesInvoiceFilters: false,
  },
  {
    id: "model-performance",
    title: "Model performance summary",
    description: "Recorded evaluation metrics for the classifier, regressor and clustering model.",
    icon: Bot,
    usesInvoiceFilters: false,
  },
  {
    id: "invoice-summary",
    title: "Invoice portfolio summary",
    description: "Full invoice ledger with status, currency and recorded model scores.",
    icon: FileSpreadsheet,
    usesInvoiceFilters: true,
  },
];

const TYPE_LABELS: Record<ReportType, string> = {
  "late-risk": "Late-payment risk register",
  "payment-delay": "Payment-delay forecast",
  segmentation: "Customer segment profile",
  "model-performance": "Model performance summary",
  "invoice-summary": "Invoice portfolio summary",
};

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function invoiceRows(invoices: Invoice[]): Record<string, string | number>[] {
  return invoices.map((invoice) => ({
    invoiceId: invoice.id,
    customer: invoice.customerName,
    customerId: invoice.customerId,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    paymentDate: invoice.paymentDate ?? "",
    status: invoice.status,
    amount: invoice.amount,
    currency: invoice.currency,
    lateProbability: invoice.lateProbability == null ? "" : formatProbability(invoice.lateProbability),
    riskBand: invoice.riskBand ?? "",
    predictedDelayDays: invoice.predictedDelay == null ? "" : formatDelayShort(invoice.predictedDelay),
    actualDelayDays: invoice.delayDays == null ? "" : formatDelayShort(invoice.delayDays),
  }));
}

const INVOICE_COLUMNS = [
  { key: "invoiceId", label: "Invoice ID" },
  { key: "customer", label: "Customer" },
  { key: "customerId", label: "Customer ID" },
  { key: "invoiceDate", label: "Invoice date" },
  { key: "dueDate", label: "Due date" },
  { key: "paymentDate", label: "Payment date" },
  { key: "status", label: "Status" },
  { key: "amount", label: "Amount" },
  { key: "currency", label: "Currency" },
  { key: "lateProbability", label: "Late probability" },
  { key: "riskBand", label: "Risk band" },
  { key: "predictedDelayDays", label: "Predicted delay (days)" },
  { key: "actualDelayDays", label: "Actual delay (days)" },
];

const CURRENCY_NOTE =
  "Amounts in USD and CAD are shown nominally. The dataset has not been FX-converted, so aggregates should not be read as a single-currency total.";
const SCORE_NOTE =
  "Only invoices inside the recorded scored window carry a model output. Unscored invoices are listed without a probability or delay estimate.";

export default function ReportsPage() {
  const [type, setType] = useState<ReportType>("late-risk");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [riskBand, setRiskBand] = useState<"all" | "Low" | "Medium" | "High">("all");
  const [status, setStatus] = useState<"all" | "paid" | "open" | "overdue">("all");
  const [generating, setGenerating] = useState(false);
  const [report, setReport] = useState<GeneratedReport | null>(null);
  const [sessionReports, setSessionReports] = useState<GeneratedReport[]>([]);

  const activeOption = TYPE_OPTIONS.find((option) => option.id === type) ?? TYPE_OPTIONS[0];

  useEffect(() => {
    setReport(null);
  }, [type, dateFrom, dateTo, riskBand, status]);

  const previewColumns = useMemo(
    () => (report ? report.columns.slice(0, 8) : []),
    [report],
  );

  async function generateReport() {
    if (dateFrom && dateTo && dateFrom > dateTo) {
      toast.error("The start date must be before the end date.");
      return;
    }

    setGenerating(true);
    try {
      let generated: GeneratedReport;

      if (type === "late-risk") {
        const response = await api.reportInvoices({
          hasPrediction: true,
          riskBand,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          sortBy: "lateProbability",
          sortOrder: "desc",
        });
        const scored = response.items.filter((invoice) => invoice.lateProbability != null);
        const high = scored.filter((invoice) => invoice.riskBand === "High").length;
        const average =
          scored.length > 0
            ? scored.reduce((sum, invoice) => sum + (invoice.lateProbability ?? 0), 0) / scored.length
            : 0;
        generated = {
          id: `late-risk-${Date.now()}`,
          type,
          title: "Late-payment risk register",
          generatedAt: new Date().toISOString(),
          rows: invoiceRows(scored),
          columns: INVOICE_COLUMNS,
          summary: [
            { label: "Scored invoices", value: formatNumber(scored.length) },
            { label: "Average probability", value: scored.length ? formatProbability(average) : "—" },
            { label: "High-risk invoices", value: formatNumber(high) },
            { label: "Decision threshold", value: "45%" },
          ],
          notes: [
            SCORE_NOTE,
            CURRENCY_NOTE,
            "Risk bands: Low < 30%, Medium 30–70%, High ≥ 70%. The classifier decision threshold is 45%.",
            "Recorded historical scores; they are not a guarantee of future payment behaviour.",
          ],
        };
      } else if (type === "payment-delay") {
        const response = await api.reportInvoices({
          hasDelayPrediction: true,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          sortBy: "predictedDelay",
          sortOrder: "desc",
        });
        const scored = response.items.filter((invoice) => invoice.predictedDelay != null);
        const average =
          scored.length > 0
            ? scored.reduce((sum, invoice) => sum + (invoice.predictedDelay ?? 0), 0) / scored.length
            : 0;
        const late = scored.filter((invoice) => (invoice.predictedDelay ?? 0) > 0.5).length;
        const early = scored.filter((invoice) => (invoice.predictedDelay ?? 0) < -0.5).length;
        generated = {
          id: `payment-delay-${Date.now()}`,
          type,
          title: "Payment-delay forecast",
          generatedAt: new Date().toISOString(),
          rows: invoiceRows(scored),
          columns: INVOICE_COLUMNS,
          summary: [
            { label: "Scored invoices", value: formatNumber(scored.length) },
            { label: "Average predicted delay", value: scored.length ? formatSignedDays(average) : "—" },
            { label: "Predicted late", value: `${formatNumber(late)} · ${scored.length ? ((late / scored.length) * 100).toFixed(1) : "0.0"}%` },
            { label: "Predicted early", value: `${formatNumber(early)} · ${scored.length ? ((early / scored.length) * 100).toFixed(1) : "0.0"}%` },
          ],
          notes: [
            "Delay is signed: negative values mean early, positive values mean late, near zero means on time.",
            SCORE_NOTE,
            CURRENCY_NOTE,
            "Estimates come from the HistGradientBoosting regressor evaluated on held-out validation data.",
          ],
        };
      } else if (type === "segmentation") {
        const response = await api.customers({ page: 1, pageSize: 5000, sortBy: "clusterId", sortOrder: "asc" });
        const clusterIds = new Set(response.items.map((customer) => customer.clusterId));
        const averageLateRatio =
          response.items.length > 0
            ? response.items.reduce((sum, customer) => sum + customer.latePaymentRatio, 0) / response.items.length
            : 0;
        generated = {
          id: `segmentation-${Date.now()}`,
          type,
          title: "Customer segment profile",
          generatedAt: new Date().toISOString(),
          rows: response.items.map((customer) => ({
            customerId: customer.id,
            customer: customer.name,
            segment: customer.clusterId,
            invoices: customer.totalInvoices,
            latePaymentRatio: formatProbability(customer.latePaymentRatio),
            avgPaymentDelayDays: formatDelayShort(customer.avgPaymentDelay),
            avgInvoiceAmount: Math.round(customer.avgInvoiceAmount),
            outstandingAmount: Math.round(customer.outstandingAmount),
          })),
          columns: [
            { key: "customerId", label: "Customer ID" },
            { key: "customer", label: "Customer" },
            { key: "segment", label: "Segment" },
            { key: "invoices", label: "Invoices" },
            { key: "latePaymentRatio", label: "Late payment ratio" },
            { key: "avgPaymentDelayDays", label: "Avg payment delay" },
            { key: "avgInvoiceAmount", label: "Avg invoice amount (nominal)" },
            { key: "outstandingAmount", label: "Outstanding amount (nominal)" },
          ],
          summary: [
            { label: "Customers", value: formatNumber(response.items.length) },
            { label: "Segments", value: formatNumber(clusterIds.size) },
            { label: "Average late ratio", value: formatProbability(averageLateRatio) },
            { label: "Clustering", value: "K-Means · K=6" },
          ],
          notes: [
            "Segments come from K-Means with K=6 on behavioural features. Small clusters are outlier groups, not strategic accounts.",
            "The average late ratio is an unweighted mean across customers, not across invoices.",
            "PCA coordinates and cluster profiles are available on the Customer Segments page.",
            CURRENCY_NOTE,
          ],
        };
      } else if (type === "model-performance") {
        const metrics = await api.modelMetrics();
        const rows: Record<string, string | number>[] = [
          { model: "Late-payment classifier", task: "Classification", metric: "ROC AUC", value: metrics.latePayment.testMetrics.roc_auc.toFixed(4) },
          { model: "Late-payment classifier", task: "Classification", metric: "PR AUC", value: metrics.latePayment.testMetrics.pr_auc.toFixed(4) },
          { model: "Late-payment classifier", task: "Classification", metric: "Precision (45%)", value: metrics.latePayment.operationalThresholdMetrics.precision.toFixed(4) },
          { model: "Late-payment classifier", task: "Classification", metric: "Recall (45%)", value: metrics.latePayment.operationalThresholdMetrics.recall.toFixed(4) },
          { model: "Late-payment classifier", task: "Classification", metric: "F1 (45%)", value: metrics.latePayment.operationalThresholdMetrics.f1.toFixed(4) },
          { model: "Payment-delay regressor", task: "Regression", metric: "MAE (days)", value: metrics.paymentDelay.testMetrics.MAE.toFixed(2) },
          { model: "Payment-delay regressor", task: "Regression", metric: "RMSE (days)", value: metrics.paymentDelay.testMetrics.RMSE.toFixed(2) },
          { model: "Payment-delay regressor", task: "Regression", metric: "R²", value: metrics.paymentDelay.testMetrics.R2.toFixed(4) },
          { model: "Payment-delay regressor", task: "Regression", metric: "Median AE (days)", value: metrics.paymentDelay.testMetrics.MedAE.toFixed(2) },
          { model: "Customer segmentation", task: "Clustering", metric: "Silhouette", value: metrics.clustering.silhouette.toFixed(4) },
          { model: "Customer segmentation", task: "Clustering", metric: "Calinski-Harabasz", value: metrics.clustering.calinskiHarabasz.toFixed(2) },
          { model: "Customer segmentation", task: "Clustering", metric: "Davies-Bouldin", value: metrics.clustering.daviesBouldin.toFixed(4) },
          { model: "Customer segmentation", task: "Clustering", metric: "Mean ARI (seeds)", value: metrics.clustering.stability.mean_ARI.toFixed(4) },
        ];
        generated = {
          id: `model-performance-${Date.now()}`,
          type,
          title: "Model performance summary",
          generatedAt: new Date().toISOString(),
          rows,
          columns: [
            { key: "model", label: "Model" },
            { key: "task", label: "Task" },
            { key: "metric", label: "Metric" },
            { key: "value", label: "Value" },
          ],
          summary: [
            { label: "Late ROC AUC", value: metrics.latePayment.testMetrics.roc_auc.toFixed(3) },
            { label: "Delay MAE", value: `${metrics.paymentDelay.testMetrics.MAE.toFixed(2)} days` },
            { label: "Silhouette", value: metrics.clustering.silhouette.toFixed(3) },
            { label: "Decision threshold", value: "45%" },
          ],
          notes: [
            metrics.latePayment.metricSource,
            metrics.paymentDelay.metricSource,
            metrics.clustering.metricSource,
            metrics.methodology.disclaimer,
          ],
        };
      } else {
        const response = await api.reportInvoices({
          status,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          sortBy: "invoiceDate",
          sortOrder: "desc",
        });
        const totalAmount = response.items.reduce((sum, invoice) => sum + invoice.amount, 0);
        const openInvoices = response.items.filter((invoice) => invoice.status === "open").length;
        const scored = response.items.filter((invoice) => invoice.lateProbability != null).length;
        generated = {
          id: `invoice-summary-${Date.now()}`,
          type,
          title: "Invoice portfolio summary",
          generatedAt: new Date().toISOString(),
          rows: invoiceRows(response.items),
          columns: INVOICE_COLUMNS,
          summary: [
            { label: "Invoices", value: formatNumber(response.items.length) },
            { label: "Nominal total", value: formatNumber(totalAmount) },
            { label: "Open invoices", value: formatNumber(openInvoices) },
            { label: "Scored invoices", value: formatNumber(scored) },
          ],
          notes: [
            CURRENCY_NOTE,
            SCORE_NOTE,
            "Status reflects the recorded dataset snapshot, not a live receivables ledger.",
          ],
        };
      }

      setReport(generated);
      setSessionReports((previous) => [generated, ...previous].slice(0, 5));
      toast.success(`${TYPE_LABELS[generated.type]} generated`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Report generation failed");
    } finally {
      setGenerating(false);
    }
  }

  function downloadReportCsv(target: GeneratedReport) {
    downloadCsv(
      `flowcred-${target.type}-${todayStamp()}.csv`,
      target.rows,
      target.columns.map((column) => ({ key: column.key, label: column.label })),
    );
    toast.success("CSV download started");
  }

  function downloadReportPdf(target: GeneratedReport) {
    const limit = 250;
    const rows = target.rows.slice(0, limit).map((row) =>
      target.columns.map((column) => row[column.key] ?? ""),
    );
    const notes = [...target.notes];
    if (target.rows.length > limit) {
      notes.push(`PDF preview limited to the first ${limit} of ${formatNumber(target.rows.length)} rows. Export CSV for the full dataset.`);
    }
    downloadPdf({
      filename: `flowcred-${target.type}-${todayStamp()}.pdf`,
      title: target.title,
      subtitle: `FlowCred AI · Generated ${formatDate(target.generatedAt)}`,
      summary: target.summary,
      columns: target.columns.map((column) => column.label),
      rows,
      notes,
    });
    toast.success("PDF download started");
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Workspace"
        title="Reports"
        description="Assemble a report from the recorded data, review the summary, then export it. Downloads unlock only after a report has been generated."
      />

      <InfoNote>
        Reports are generated in the browser from the same API responses used across the dashboard. Nothing is scheduled,
        emailed or stored server-side. Changing a filter clears the current report so exports always match the visible
        settings.
      </InfoNote>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader className="pb-3">
              <SectionHeading title="Report builder" description="Choose a report type and constrain the data window." />
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-2">
                {TYPE_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  const selected = option.id === type;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setType(option.id)}
                      className={cn(
                        "flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors",
                        selected
                          ? "border-brand-accent bg-[#F1F6FD] shadow-sm"
                          : "border-border bg-card hover:border-brand-accent/40 hover:bg-muted/30",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-lg",
                          selected ? "bg-brand-accent text-white" : "bg-muted text-muted-foreground",
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="text-xs font-semibold leading-snug text-foreground">{option.title}</span>
                      <span className="text-[11px] leading-relaxed text-muted-foreground">{option.description}</span>
                    </button>
                  );
                })}
              </div>

              {activeOption.usesInvoiceFilters ? (
                <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    Invoice date from
                    <Input
                      type="date"
                      className="mt-1.5"
                      value={dateFrom}
                      onChange={(event) => setDateFrom(event.target.value)}
                    />
                  </label>
                  <label className="text-xs font-medium text-muted-foreground">
                    Invoice date to
                    <Input
                      type="date"
                      className="mt-1.5"
                      value={dateTo}
                      onChange={(event) => setDateTo(event.target.value)}
                    />
                  </label>
                  {type === "late-risk" ? (
                    <label className="text-xs font-medium text-muted-foreground sm:col-span-2">
                      Risk band
                      <Select
                        className="mt-1.5"
                        value={riskBand}
                        onChange={(event) => setRiskBand(event.target.value as typeof riskBand)}
                      >
                        <option value="all">All risk bands</option>
                        <option value="High">High (≥ 70%)</option>
                        <option value="Medium">Medium (30–70%)</option>
                        <option value="Low">Low (&lt; 30%)</option>
                      </Select>
                    </label>
                  ) : null}
                  {type === "invoice-summary" ? (
                    <label className="text-xs font-medium text-muted-foreground sm:col-span-2">
                      Invoice status
                      <Select
                        className="mt-1.5"
                        value={status}
                        onChange={(event) => setStatus(event.target.value as typeof status)}
                      >
                        <option value="all">All invoices</option>
                        <option value="paid">Paid only</option>
                        <option value="open">Open only</option>
                        <option value="overdue">Overdue only</option>
                      </Select>
                    </label>
                  ) : null}
                </div>
              ) : (
                <p className="flex items-start gap-2 border-t border-border pt-4 text-[11px] leading-relaxed text-muted-foreground">
                  <CalendarRange className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  This report always covers the complete recorded dataset snapshot; date filters do not apply.
                </p>
              )}

              <Button className="w-full" onClick={() => void generateReport()} disabled={generating}>
                <ListChecks className="h-4 w-4" />
                {generating ? "Generating…" : "Generate report"}
              </Button>

              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Generation reads the current API dataset. It does not run inference and will not invent scores for
                unscored invoices.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">This session</CardTitle>
              <p className="text-xs text-muted-foreground">Generated reports remain available until the page reloads.</p>
            </CardHeader>
            <CardContent>
              {sessionReports.length === 0 ? (
                <p className="text-xs text-muted-foreground">No reports generated in this session.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {sessionReports.map((entry) => (
                    <li key={entry.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-foreground">{entry.title}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatNumber(entry.rows.length)} rows · {formatDate(entry.generatedAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Download ${entry.title} CSV`}
                          onClick={() => downloadReportCsv(entry)}
                        >
                          <FileSpreadsheet className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Download ${entry.title} PDF`}
                          onClick={() => downloadReportPdf(entry)}
                        >
                          <FileText className="h-4 w-4" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="flex min-h-[520px] flex-col">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">Report preview</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {report ? `${report.title} · ${formatNumber(report.rows.length)} rows` : "Generate a report to unlock exports"}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!report}
                  onClick={() => report && downloadReportCsv(report)}
                >
                  <Download className="h-4 w-4" />
                  CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!report}
                  onClick={() => report && downloadReportPdf(report)}
                >
                  <Download className="h-4 w-4" />
                  PDF
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col">
            {!report ? (
              <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border bg-muted/20">
                <EmptyState
                  icon={FileText}
                  title="No report generated yet"
                  description="Pick a report type, adjust the data window, then select Generate report. CSV and PDF export stay disabled until a report exists."
                />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="accent">{TYPE_LABELS[report.type]}</Badge>
                  <span className="text-[11px] text-muted-foreground">
                    Generated {new Date(report.generatedAt).toLocaleString("en-GB")}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {report.summary.map((item) => (
                    <div key={item.label} className="rounded-lg border border-border bg-muted/20 px-3 py-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        {item.label}
                      </p>
                      <p className="mt-1 truncate text-sm font-semibold text-foreground tabular" title={item.value}>
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>

                {report.rows.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-10 text-center">
                    <p className="text-sm font-medium text-foreground">No rows match this configuration</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      The report was generated but returned an empty result. Adjust the filters and generate again.
                    </p>
                  </div>
                ) : (
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span>Preview · first {Math.min(report.rows.length, 12)} rows</span>
                      <span className="tabular">
                        {report.columns.length} columns · {formatNumber(report.rows.length)} rows total
                      </span>
                    </div>
                    <div className="max-h-[340px] overflow-auto rounded-lg border border-border">
                      <table className="w-full text-left text-[11px]">
                        <thead className="sticky top-0 bg-muted/90 text-[10px] uppercase tracking-wide text-muted-foreground backdrop-blur">
                          <tr>
                            {previewColumns.map((column) => (
                              <th key={column.key} className="whitespace-nowrap px-3 py-2 font-semibold">
                                {column.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {report.rows.slice(0, 12).map((row, index) => (
                            <tr key={index} className="border-t border-border/70">
                              {previewColumns.map((column) => (
                                <td key={column.key} className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                                  {row[column.key] === "" || row[column.key] === undefined ? "—" : row[column.key]}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {report.columns.length > previewColumns.length ? (
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        Preview shows the first {previewColumns.length} columns. CSV and PDF include all{" "}
                        {report.columns.length}.
                      </p>
                    ) : null}
                  </div>
                )}

                <div className="rounded-lg border border-border bg-muted/20 p-3.5">
                  <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    <Sparkles className="h-3.5 w-3.5" />
                    Notes included in the export
                  </p>
                  <ul className="space-y-1 text-[11px] leading-relaxed text-muted-foreground">
                    {report.notes.map((note) => (
                      <li key={note} className="flex gap-2">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand-accent" />
                        <span>{note}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
