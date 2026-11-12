import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowUpRight, Layers, Users } from "lucide-react";
import { useCustomers, useSegments } from "@/api/queries";
import { PageHeader } from "@/components/common/page-header";
import { SearchInput } from "@/components/common/search-input";
import { FilterPanel, FilterField } from "@/components/common/filter-panel";
import { DataTable, type DataTableColumn, type SortState } from "@/components/common/data-table";
import { Pagination } from "@/components/common/pagination";
import { ErrorState } from "@/components/common/states";
import { PageSkeleton } from "@/components/common/loading";
import { InfoNote } from "@/components/common/notes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { CLUSTER_COLORS } from "@/lib/constants";
import {
  formatDate,
  formatDelayShort,
  formatNumber,
  formatPercent,
  formatProbability,
} from "@/lib/format";
import type { Customer, CustomerListParams } from "@/types";

const ALL = "all";

export default function CustomersPage() {
  const navigate = useNavigate();
  const { data: segments } = useSegments();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [clusterId, setClusterId] = useState<string>(searchParams.get("cluster") ?? ALL);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState<SortState>({ by: "name", order: "asc" });

  useEffect(() => {
    const cluster = searchParams.get("cluster");
    if (cluster) setClusterId(cluster);
  }, [searchParams]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, clusterId, pageSize]);

  const params: CustomerListParams = useMemo(
    () => ({
      page,
      pageSize,
      search: debouncedSearch.trim() || undefined,
      clusterId: clusterId === ALL ? ALL : Number(clusterId),
      sortBy: sort.by,
      sortOrder: sort.order,
    }),
    [page, pageSize, debouncedSearch, clusterId, sort],
  );

  const { data, isLoading, isError, error, refetch, isFetching } = useCustomers(params);

  const clusterOptions = segments?.sizes ?? [0, 1, 2, 3, 4, 5].map((id) => ({ clusterId: id, customers: 0 }));

  const columns: DataTableColumn<Customer>[] = [
    {
      id: "name",
      header: "Customer",
      sortable: true,
      cell: (customer) => (
        <div className="min-w-[170px]">
          <p className="truncate font-medium text-foreground">{customer.name}</p>
          <p className="text-[11px] text-muted-foreground">{customer.id}</p>
        </div>
      ),
    },
    {
      id: "clusterId",
      header: "Segment",
      sortable: true,
      cell: (customer) => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: CLUSTER_COLORS[customer.clusterId % CLUSTER_COLORS.length] }}
          />
          Cluster {customer.clusterId}
        </span>
      ),
    },
    {
      id: "totalInvoices",
      header: "Invoices",
      sortable: true,
      align: "right",
      cell: (customer) => <span className="tabular">{formatNumber(customer.totalInvoices)}</span>,
    },
    {
      id: "outstandingAmount",
      header: "Outstanding",
      sortable: true,
      align: "right",
      cell: (customer) => <span className="tabular">{formatNumber(customer.outstandingAmount, true)}</span>,
    },
    {
      id: "latePaymentRatio",
      header: "Late ratio",
      sortable: true,
      align: "right",
      cell: (customer) => (
        <span className="tabular">{formatPercent(customer.latePaymentRatio, true)}</span>
      ),
    },
    {
      id: "avgPaymentDelay",
      header: "Avg delay",
      sortable: true,
      align: "right",
      cell: (customer) => <span className="tabular text-muted-foreground">{formatDelayShort(customer.avgPaymentDelay)}</span>,
    },
    {
      id: "avgLateProbability",
      header: "Avg late prob.",
      sortable: true,
      align: "right",
      cell: (customer) =>
        customer.scoredInvoices && customer.scoredInvoices > 0 ? (
          <div>
            <span className="tabular text-foreground">{formatProbability(customer.avgLateProbability ?? null)}</span>
            <p className="text-[10px] text-muted-foreground">{formatNumber(customer.scoredInvoices)} scored</p>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Not scored</span>
        ),
    },
    {
      id: "highRiskInvoices",
      header: "High risk",
      sortable: true,
      align: "right",
      cell: (customer) => (
        <span className={customer.highRiskInvoices ? "font-medium tabular text-risk-high" : "tabular text-muted-foreground"}>
          {formatNumber(customer.highRiskInvoices ?? 0)}
        </span>
      ),
    },
    {
      id: "lastInvoiceDate",
      header: "Last invoice",
      sortable: true,
      cell: (customer) => (
        <span className="whitespace-nowrap tabular text-muted-foreground">{formatDate(customer.lastInvoiceDate)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Customer intelligence"
        title="Customer directory"
        description="Behavioural and receivables profile for every customer in the dataset. Segment IDs are neutral labels from the K-Means model; descriptive names have not been approved by the business."
        actions={
          <Button variant="outline" asChild>
            <Link to="/customer-segments">
              <Layers className="h-4 w-4" />
              Segment explorer
            </Link>
          </Button>
        }
      />

      <InfoNote>
        Outstanding values are nominal and aggregations may combine USD and CAD invoices with no FX conversion. Average
        late probability is only shown for customers with scored invoices in the evaluation window.
      </InfoNote>

      <FilterPanel
        activeCount={(clusterId !== ALL ? 1 : 0) + (search ? 1 : 0)}
        onClear={() => {
          setClusterId(ALL);
          setSearch("");
        }}
        title="Customer filters"
      >
        <FilterField label="Search" className="sm:col-span-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Customer name or identifier…" />
        </FilterField>
        <FilterField label="Segment">
          <Select value={clusterId} onChange={(event) => setClusterId(event.target.value)}>
            <option value="all">All clusters</option>
            {clusterOptions.map((option) => (
              <option key={option.clusterId} value={option.clusterId}>
                Cluster {option.clusterId}
                {option.customers ? ` · ${formatNumber(option.customers)}` : ""}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Directory size">
          <div className="flex h-10 items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 text-sm text-muted-foreground">
            <Users className="h-4 w-4" />
            {data ? `${formatNumber(data.total)} customers` : "Loading…"}
          </div>
        </FilterField>
      </FilterPanel>

      {isLoading ? (
        <PageSkeleton />
      ) : isError ? (
        <ErrorState
          title="Customers could not be loaded"
          description={error instanceof Error ? error.message : "The customer endpoint did not respond."}
          onRetry={() => refetch()}
        />
      ) : data ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground tabular">{formatNumber(data.total)}</span> customers match the
              current filters
              {isFetching ? <span className="ml-2 text-brand-accent">updating…</span> : null}
            </p>
            <p className="text-[11px] text-muted-foreground">Select a customer for the full 360° profile</p>
          </div>
          <DataTable
            data={data.items}
            columns={columns}
            getRowId={(customer) => customer.id}
            sort={sort}
            onSortChange={(next) => {
              setSort(next);
              setPage(1);
            }}
            onRowClick={(customer) => navigate(`/customers/${customer.id}`)}
            emptyTitle="No customers match"
            emptyDescription="Adjust the segment filter or clear the search term."
            className="rounded-none border-0 border-t"
          />
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            totalPages={data.totalPages}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            itemLabel="customers"
          />
        </div>
      ) : null}

      {segments ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {segments.sizes.map((segment) => (
            <Link
              key={segment.clusterId}
              to={`/customer-segments?cluster=${segment.clusterId}`}
              className="group flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-card transition-colors hover:border-brand-accent/40"
            >
              <div className="flex items-center gap-3">
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-xs font-semibold text-white"
                  style={{ backgroundColor: CLUSTER_COLORS[segment.clusterId % CLUSTER_COLORS.length] }}
                >
                  {segment.clusterId}
                </span>
                <div>
                  <p className="text-sm font-medium text-foreground">Cluster {segment.clusterId}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatNumber(segment.customers)} customers · {segment.percentage.toFixed(1)}%
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {segment.isSmall ? <Badge variant="medium">Small group</Badge> : null}
                <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-brand-accent" />
              </div>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
