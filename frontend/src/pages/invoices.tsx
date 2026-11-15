import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Download, FileSearch } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api";
import { useInvoices } from "@/api/queries";
import { PageHeader } from "@/components/common/page-header";
import { SearchInput } from "@/components/common/search-input";
import { FilterPanel, FilterField } from "@/components/common/filter-panel";
import { DataTable, type DataTableColumn, type SortState } from "@/components/common/data-table";
import { Pagination } from "@/components/common/pagination";
import { RiskBadge, StatusBadge } from "@/components/common/badges";
import { ErrorState } from "@/components/common/states";
import { PageSkeleton } from "@/components/common/loading";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { downloadCsv } from "@/lib/csv";
import {
  formatCurrency,
  formatDate,
  formatDelayShort,
  formatNumber,
  formatProbability,
} from "@/lib/format";
import type { Invoice, InvoiceListParams } from "@/types";

const ALL = "all";

export default function InvoicesPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [status, setStatus] = useState<string>(ALL);
  const [riskBand, setRiskBand] = useState<string>(ALL);
  const [prediction, setPrediction] = useState<"all" | "yes" | "no">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState<SortState>({ by: "invoiceDate", order: "desc" });
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status, riskBand, prediction, dateFrom, dateTo, amountMin, amountMax, pageSize]);

  const params: InvoiceListParams = useMemo(
    () => ({
      page,
      pageSize,
      search: debouncedSearch.trim() || undefined,
      status: status as InvoiceListParams["status"],
      riskBand: riskBand as InvoiceListParams["riskBand"],
      hasPrediction: prediction === "all" ? undefined : prediction === "yes",
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      amountMin: amountMin ? Number(amountMin) : undefined,
      amountMax: amountMax ? Number(amountMax) : undefined,
      sortBy: sort.by,
      sortOrder: sort.order,
    }),
    [page, pageSize, debouncedSearch, status, riskBand, prediction, dateFrom, dateTo, amountMin, amountMax, sort],
  );

  const { data, isLoading, isError, error, refetch, isFetching } = useInvoices(params);

  const activeFilters = [
    status !== ALL,
    riskBand !== ALL,
    prediction !== ALL,
    Boolean(dateFrom),
    Boolean(dateTo),
    Boolean(amountMin),
    Boolean(amountMax),
  ].filter(Boolean).length;

  function clearFilters() {
    setStatus(ALL);
    setRiskBand(ALL);
    setPrediction("all");
    setDateFrom("");
    setDateTo("");
    setAmountMin("");
    setAmountMax("");
  }

  async function handleExport() {
    setExporting(true);
    try {
      const response = await api.reportInvoices(params);
      const rows = response.items.map((invoice) => ({
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        customerName: invoice.customerName,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        paymentDate: invoice.paymentDate ?? "",
        paymentTerms: invoice.paymentTerms,
        status: invoice.status,
        amount: invoice.amount,
        currency: invoice.currency,
        lateProbability: invoice.lateProbability ?? "",
        riskBand: invoice.riskBand ?? "",
        predictedDelayDays: invoice.predictedDelay ?? "",
        actualDelayDays: invoice.delayDays ?? "",
      }));
      downloadCsv(`flowcred-invoices-${new Date().toISOString().slice(0, 10)}.csv`, rows, [
        { key: "invoiceId", label: "Invoice ID" },
        { key: "customerId", label: "Customer ID" },
        { key: "customerName", label: "Customer" },
        { key: "invoiceDate", label: "Invoice date" },
        { key: "dueDate", label: "Due date" },
        { key: "paymentDate", label: "Payment date" },
        { key: "paymentTerms", label: "Payment terms" },
        { key: "status", label: "Status" },
        { key: "amount", label: "Amount" },
        { key: "currency", label: "Currency" },
        { key: "lateProbability", label: "Late probability" },
        { key: "riskBand", label: "Risk band" },
        { key: "predictedDelayDays", label: "Predicted delay (days)" },
        { key: "actualDelayDays", label: "Actual delay (days)" },
      ]);
      toast.success(`Exported ${formatNumber(rows.length)} invoices to CSV`);
    } catch (exportError) {
      toast.error(exportError instanceof Error ? exportError.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  const columns: DataTableColumn<Invoice>[] = [
    {
      id: "id",
      header: "Invoice",
      sortable: true,
      cell: (invoice) => (
        <div className="min-w-[110px]">
          <p className="font-medium text-foreground">{invoice.id}</p>
          <p className="text-[11px] text-muted-foreground">{invoice.paymentTerms}</p>
        </div>
      ),
    },
    {
      id: "customerName",
      header: "Customer",
      sortable: true,
      cell: (invoice) => (
        <div className="min-w-[160px]">
          <p className="truncate text-foreground">{invoice.customerName}</p>
          <p className="text-[11px] text-muted-foreground">{invoice.customerId}</p>
        </div>
      ),
    },
    {
      id: "invoiceDate",
      header: "Invoice date",
      sortable: true,
      cell: (invoice) => <span className="whitespace-nowrap tabular">{formatDate(invoice.invoiceDate)}</span>,
    },
    {
      id: "dueDate",
      header: "Due date",
      sortable: true,
      cell: (invoice) => <span className="whitespace-nowrap tabular">{formatDate(invoice.dueDate)}</span>,
    },
    {
      id: "status",
      header: "Status",
      sortable: true,
      cell: (invoice) => <StatusBadge status={invoice.status} />,
    },
    {
      id: "lateProbability",
      header: "Late probability",
      sortable: true,
      align: "right",
      cell: (invoice) =>
        invoice.lateProbability == null ? (
          <span className="text-xs text-muted-foreground">Not scored</span>
        ) : (
          <div className="min-w-[84px] text-right">
            <span className="font-medium tabular text-foreground">{formatProbability(invoice.lateProbability)}</span>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${invoice.lateProbability * 100}%`,
                  backgroundColor:
                    invoice.riskBand === "High" ? "#DC2626" : invoice.riskBand === "Medium" ? "#B45309" : "#15803D",
                }}
              />
            </div>
          </div>
        ),
    },
    {
      id: "riskBand",
      header: "Risk",
      sortable: true,
      cell: (invoice) => <RiskBadge band={invoice.riskBand} />,
    },
    {
      id: "predictedDelay",
      header: "Predicted delay",
      sortable: true,
      align: "right",
      cell: (invoice) => (
        <span className="whitespace-nowrap tabular text-muted-foreground">
          {formatDelayShort(invoice.predictedDelay)}
        </span>
      ),
    },
    {
      id: "amount",
      header: "Amount",
      sortable: true,
      align: "right",
      cell: (invoice) => (
        <span className="whitespace-nowrap font-medium tabular">{formatCurrency(invoice.amount, invoice.currency)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Analytics"
        title="Invoice ledger"
        description="Search every invoice in the cleaned dataset. Risk bands and delay estimates are only shown where the trained models produced a recorded score."
        actions={
          <>
            <Button variant="outline" onClick={handleExport} disabled={exporting || isLoading}>
              <Download className="h-4 w-4" />
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
            <Button asChild>
              <Link to="/reports">
                <FileSearch className="h-4 w-4" />
                Reports
              </Link>
            </Button>
          </>
        }
      />

      <FilterPanel onClear={clearFilters} activeCount={activeFilters} title="Invoice filters">
        <FilterField label="Search" className="sm:col-span-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Invoice ID, customer, customer ID or terms…" />
        </FilterField>
        <FilterField label="Status">
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All statuses</option>
            <option value="paid">Paid</option>
            <option value="open">Open</option>
            <option value="overdue">Overdue</option>
          </Select>
        </FilterField>
        <FilterField label="Risk band">
          <Select value={riskBand} onChange={(event) => setRiskBand(event.target.value)}>
            <option value="all">All bands</option>
            <option value="Low">Low (&lt; 30%)</option>
            <option value="Medium">Medium (30–70%)</option>
            <option value="High">High (≥ 70%)</option>
          </Select>
        </FilterField>
        <FilterField label="Model score">
          <Select value={prediction} onChange={(event) => setPrediction(event.target.value as "all" | "yes" | "no")}>
            <option value="all">Scored and unscored</option>
            <option value="yes">Has late-payment score</option>
            <option value="no">No model score</option>
          </Select>
        </FilterField>
        <FilterField label="Invoice date from">
          <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </FilterField>
        <FilterField label="Invoice date to">
          <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </FilterField>
        <FilterField label="Minimum amount">
          <Input
            type="number"
            min={0}
            inputMode="decimal"
            placeholder="0"
            value={amountMin}
            onChange={(event) => setAmountMin(event.target.value)}
          />
        </FilterField>
        <FilterField label="Maximum amount">
          <Input
            type="number"
            min={0}
            inputMode="decimal"
            placeholder="Any"
            value={amountMax}
            onChange={(event) => setAmountMax(event.target.value)}
          />
        </FilterField>
      </FilterPanel>

      {isLoading ? (
        <PageSkeleton />
      ) : isError ? (
        <ErrorState
          title="Invoices could not be loaded"
          description={error instanceof Error ? error.message : "The invoice endpoint did not respond."}
          onRetry={() => refetch()}
        />
      ) : data ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground tabular">{formatNumber(data.total)}</span> invoices match the
              current filters
              {isFetching ? <span className="ml-2 text-brand-accent">updating…</span> : null}
            </p>
            <p className="text-[11px] text-muted-foreground">Click a row to open invoice intelligence</p>
          </div>
          <DataTable
            data={data.items}
            columns={columns}
            getRowId={(invoice) => invoice.id}
            sort={sort}
            onSortChange={(next) => {
              setSort(next);
              setPage(1);
            }}
            onRowClick={(invoice) => navigate(`/invoices/${invoice.id}`)}
            emptyTitle="No invoices match these filters"
            emptyDescription="Try widening the date range, clearing the risk band, or searching by customer."
            emptyAction={
              activeFilters || search ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    clearFilters();
                    setSearch("");
                  }}
                >
                  Clear all filters
                </Button>
              ) : undefined
            }
            className="rounded-none border-0 border-t"
          />
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            totalPages={data.totalPages}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            itemLabel="invoices"
          />
        </div>
      ) : null}
    </div>
  );
}
