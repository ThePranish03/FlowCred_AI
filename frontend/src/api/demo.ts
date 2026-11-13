import type {
  Customer,
  CustomerDetailResponse,
  CustomerListParams,
  DashboardResponse,
  DataQualityResponse,
  DatasetsResponse,
  DelayResponse,
  HealthResponse,
  InsightsResponse,
  Invoice,
  InvoiceDetailResponse,
  InvoiceListParams,
  ModelMetricsResponse,
  Paginated,
  RiskResponse,
  SearchResponse,
  SegmentsResponse,
} from "@/types";
import { riskFromProbability } from "@/lib/format";
import { sleep } from "@/lib/utils";

const BASE_PATH = `${import.meta.env.BASE_URL}demo-data/`;

type RawInvoice = Omit<Invoice, "customerName"> & { customerName?: string };

const cache = new Map<string, Promise<unknown>>();
let invoicesPromise: Promise<Invoice[]> | null = null;
let customerRecordsPromise: Promise<Customer[]> | null = null;
let customerAggPromise: Promise<Map<string, CustomerAgg>> | null = null;

interface CustomerAgg {
  scoredInvoices: number;
  probabilitySum: number;
  highRiskInvoices: number;
  predictedLateInvoices: number;
  delaySum: number;
  delayCount: number;
}

export class IntegrationPendingError extends Error {
  code = "INTEGRATION_PENDING";

  constructor(message: string) {
    super(message);
    this.name = "IntegrationPendingError";
  }
}

async function fetchJson<T>(file: string): Promise<T> {
  if (!cache.has(file)) {
    cache.set(
      file,
      fetch(`${BASE_PATH}${file}`, { cache: "no-cache" }).then(async (response) => {
        if (!response.ok) {
          throw new Error(`Demo fixture ${file} could not be loaded (${response.status}).`);
        }
        return response.json() as Promise<T>;
      }),
    );
  }
  return cache.get(file) as Promise<T>;
}

async function loadCustomerRecords() {
  if (!customerRecordsPromise) {
    customerRecordsPromise = fetchJson<Customer[]>("customers.json");
  }
  return customerRecordsPromise;
}

export async function loadInvoices() {
  if (!invoicesPromise) {
    invoicesPromise = (async () => {
      const [rawInvoices, customers] = await Promise.all([
        fetchJson<RawInvoice[]>("invoices.json"),
        loadCustomerRecords(),
      ]);
      const names = new Map(customers.map((customer) => [customer.id, customer.name]));
      return rawInvoices.map<Invoice>((invoice) => ({
        ...invoice,
        customerName: invoice.customerName ?? names.get(invoice.customerId) ?? "Unknown customer",
        paymentDate: invoice.paymentDate ?? null,
        delayDays: invoice.delayDays ?? null,
        isLate: invoice.isLate ?? null,
        lateProbability: invoice.lateProbability ?? null,
        riskBand: invoice.riskBand ?? (invoice.lateProbability != null ? riskFromProbability(invoice.lateProbability) : null),
        predictedDelay: invoice.predictedDelay ?? null,
        paymentTerms: invoice.paymentTerms ?? "—",
      }));
    })();
  }
  return invoicesPromise;
}

async function loadCustomerAgg() {
  if (!customerAggPromise) {
    customerAggPromise = (async () => {
      const invoices = await loadInvoices();
      const map = new Map<string, CustomerAgg>();
      for (const invoice of invoices) {
        if (!map.has(invoice.customerId)) {
          map.set(invoice.customerId, {
            scoredInvoices: 0,
            probabilitySum: 0,
            highRiskInvoices: 0,
            predictedLateInvoices: 0,
            delaySum: 0,
            delayCount: 0,
          });
        }
        const agg = map.get(invoice.customerId)!;
        if (invoice.lateProbability != null) {
          agg.scoredInvoices += 1;
          agg.probabilitySum += invoice.lateProbability;
          if (invoice.lateProbability >= 0.7) agg.highRiskInvoices += 1;
          if (invoice.lateProbability >= 0.45) agg.predictedLateInvoices += 1;
        }
        if (invoice.predictedDelay != null) {
          agg.delaySum += invoice.predictedDelay;
          agg.delayCount += 1;
        }
      }
      return map;
    })();
  }
  return customerAggPromise;
}

function enrichCustomer(customer: Customer, agg?: CustomerAgg): Customer {
  return {
    ...customer,
    scoredInvoices: agg?.scoredInvoices ?? 0,
    avgLateProbability: agg && agg.scoredInvoices > 0 ? agg.probabilitySum / agg.scoredInvoices : null,
    highRiskInvoices: agg?.highRiskInvoices ?? 0,
  };
}

export async function getDashboard() {
  await sleep(120);
  return fetchJson<DashboardResponse>("dashboard.json");
}

export async function getRiskSummary() {
  await sleep(120);
  return fetchJson<RiskResponse>("risk.json");
}

export async function getDelaySummary() {
  await sleep(120);
  return fetchJson<DelayResponse>("delay.json");
}

export async function getSegments() {
  return fetchJson<SegmentsResponse>("segments.json");
}

export async function getModelMetrics() {
  return fetchJson<ModelMetricsResponse>("model-metrics.json");
}

export async function getInsights() {
  return fetchJson<InsightsResponse>("insights.json");
}

export async function getDataQuality() {
  return fetchJson<DataQualityResponse>("data-quality.json");
}

export async function getDatasets() {
  return fetchJson<DatasetsResponse>("datasets.json");
}

export async function getHealth(): Promise<HealthResponse> {
  const models = await Promise.all([
    fetchJson<ModelMetricsResponse>("model-metrics.json"),
  ]).then(([metrics]) => [
    { id: "late-payment", status: "available", version: metrics.latePayment.version },
    { id: "payment-delay", status: "available", version: metrics.paymentDelay.version },
    { id: "clustering", status: "available", version: metrics.clustering.version },
    { id: "cash-flow", status: "coming_soon", version: null },
  ]);
  return {
    status: "demo",
    mode: "demo",
    apiVersion: "demo-fixtures-1.0",
    models,
    timestamp: new Date().toISOString(),
  };
}

function compareValues(a: unknown, b: unknown) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") {
    const numericA = a.trim() === "" ? Number.NaN : Number(a);
    const numericB = b.trim() === "" ? Number.NaN : Number(b);
    if (Number.isFinite(numericA) && Number.isFinite(numericB)) return numericA - numericB;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

const RISK_ORDER: Record<string, number> = { Low: 0, Medium: 1, High: 2 };

export async function listInvoices(params: InvoiceListParams = {}): Promise<Paginated<Invoice>> {
  const invoices = await loadInvoices();
  const {
    page = 1,
    pageSize = 20,
    search,
    customerId,
    status = "all",
    riskBand = "all",
    dateFrom,
    dateTo,
    amountMin,
    amountMax,
    hasPrediction,
    hasDelayPrediction,
    sortBy = "invoiceDate",
    sortOrder = "desc",
  } = params;

  const term = search?.trim().toLowerCase();
  let filtered = invoices.filter((invoice) => {
    if (customerId && invoice.customerId !== customerId) return false;
    if (status !== "all" && invoice.status !== status) return false;
    if (riskBand !== "all" && invoice.riskBand !== riskBand) return false;
    if (dateFrom && invoice.invoiceDate < dateFrom) return false;
    if (dateTo && invoice.invoiceDate > dateTo) return false;
    if (amountMin != null && Number.isFinite(amountMin) && invoice.amount < amountMin) return false;
    if (amountMax != null && Number.isFinite(amountMax) && invoice.amount > amountMax) return false;
    if (hasPrediction === true && invoice.lateProbability == null) return false;
    if (hasPrediction === false && invoice.lateProbability != null) return false;
    if (hasDelayPrediction === true && invoice.predictedDelay == null) return false;
    if (hasDelayPrediction === false && invoice.predictedDelay != null) return false;
    if (term) {
      const haystack = `${invoice.id} ${invoice.customerId} ${invoice.customerName} ${invoice.paymentTerms}`.toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    return true;
  });

  const direction = sortOrder === "asc" ? 1 : -1;
  filtered = filtered.sort((a, b) => {
    let result: number;
    if (sortBy === "riskBand") {
      result = (RISK_ORDER[a.riskBand ?? ""] ?? -1) - (RISK_ORDER[b.riskBand ?? ""] ?? -1);
    } else if (sortBy === "customerName") {
      result = compareValues(a.customerName, b.customerName);
    } else {
      result = compareValues((a as unknown as Record<string, unknown>)[sortBy], (b as unknown as Record<string, unknown>)[sortBy]);
    }
    if (result === 0) result = compareValues(a.id, b.id);
    return result * direction;
  });

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  return {
    items: filtered.slice(start, start + pageSize),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export async function listCustomers(params: CustomerListParams = {}): Promise<Paginated<Customer>> {
  const [records, aggMap] = await Promise.all([loadCustomerRecords(), loadCustomerAgg()]);
  const {
    page = 1,
    pageSize = 20,
    search,
    clusterId = "all",
    sortBy = "name",
    sortOrder = "asc",
  } = params;

  const term = search?.trim().toLowerCase();
  let filtered = records.filter((customer) => {
    if (clusterId !== "all" && customer.clusterId !== clusterId) return false;
    if (term && !`${customer.id} ${customer.name}`.toLowerCase().includes(term)) return false;
    return true;
  });

  const directions = sortOrder === "asc" ? 1 : -1;
  filtered = filtered
    .map((customer) => enrichCustomer(customer, aggMap.get(customer.id)))
    .sort((a, b) => {
      let result: number;
      if (sortBy === "name") result = compareValues(a.name, b.name);
      else result = compareValues((a as unknown as Record<string, unknown>)[sortBy], (b as unknown as Record<string, unknown>)[sortBy]);
      if (result === 0) result = compareValues(a.id, b.id);
      return result * directions;
    });

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  return {
    items: filtered.slice(start, start + pageSize),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getCustomerDetail(customerId: string): Promise<CustomerDetailResponse> {
  const [invoices, records, segments, aggMap] = await Promise.all([
    loadInvoices(),
    loadCustomerRecords(),
    getSegments(),
    loadCustomerAgg(),
  ]);
  const record = records.find((customer) => customer.id === customerId);
  if (!record) {
    throw new Error(`Customer ${customerId} was not found in the demo dataset.`);
  }
  const customer = enrichCustomer(record, aggMap.get(customerId));
  const history = invoices
    .filter((invoice) => invoice.customerId === customerId)
    .sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate));
  const scoredInvoices = history.filter((invoice) => invoice.lateProbability != null);
  const predictedDelays = scoredInvoices.map((invoice) => invoice.predictedDelay).filter((value): value is number => value != null);
  const probabilities = scoredInvoices.map((invoice) => invoice.lateProbability).filter((value): value is number => value != null);
  const cluster = segments.sizes.find((item) => item.clusterId === record.clusterId) ?? segments.sizes[0];

  const featureMap: { feature: keyof Customer; valueKey: keyof typeof cluster; label: string }[] = [
    { feature: "avgPaymentDelay", valueKey: "avgPaymentDelay", label: "Average payment delay" },
    { feature: "latePaymentRatio", valueKey: "avgLatePaymentRatio", label: "Late payment ratio" },
    { feature: "avgInvoiceAmount", valueKey: "avgInvoiceAmount", label: "Average invoice amount" },
    { feature: "invoiceFrequency", valueKey: "avgInvoiceFrequency", label: "Invoice frequency" },
  ];

  const comparison = featureMap.map((item) => {
    const values = records.map((candidate) => Number(candidate[item.feature])).filter(Number.isFinite);
    return {
      feature: item.feature as string,
      label: item.label,
      customerValue: Number(customer[item.feature]),
      clusterValue: Number(cluster[item.valueKey]),
      globalMedian: median(values),
    };
  });

  return {
    customer,
    cluster,
    history: history.slice(0, 240),
    scoredInvoices: scoredInvoices.slice(0, 120),
    comparison,
    risk: {
      scoredInvoices: scoredInvoices.length,
      avgProbability: probabilities.length ? probabilities.reduce((sum, value) => sum + value, 0) / probabilities.length : null,
      highRiskInvoices: scoredInvoices.filter((invoice) => (invoice.lateProbability ?? 0) >= 0.7).length,
      predictedLateInvoices: scoredInvoices.filter((invoice) => (invoice.lateProbability ?? 0) >= 0.45).length,
      avgPredictedDelay: predictedDelays.length ? predictedDelays.reduce((sum, value) => sum + value, 0) / predictedDelays.length : null,
      outstanding: customer.outstandingAmount,
    },
  };
}

export async function getInvoiceDetail(invoiceId: string): Promise<InvoiceDetailResponse> {
  const [invoices, records, segments] = await Promise.all([
    loadInvoices(),
    loadCustomerRecords(),
    getSegments(),
  ]);
  const invoice = invoices.find((item) => item.id === invoiceId);
  if (!invoice) {
    throw new Error(`Invoice ${invoiceId} was not found in the demo dataset.`);
  }
  const record = records.find((customer) => customer.id === invoice.customerId);
  if (!record) {
    throw new Error(`Customer ${invoice.customerId} was not found.`);
  }
  const cluster = segments.sizes.find((item) => item.clusterId === record.clusterId) ?? segments.sizes[0];
  const history = invoices
    .filter((item) => item.customerId === invoice.customerId)
    .sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate))
    .slice(0, 8);
  const daysUntilDue = Math.round(
    (new Date(`${invoice.dueDate}T00:00:00`).getTime() - new Date(`${invoice.invoiceDate}T00:00:00`).getTime()) /
      86_400_000,
  );

  return {
    invoice,
    customer: record,
    clusterId: record.clusterId,
    cluster,
    history,
    context: {
      previousAvgDelay: record.avgPaymentDelay,
      previousLateRatio: record.latePaymentRatio,
      previousInvoiceCount: record.totalInvoices,
      previousMedianDelay: record.medianPaymentDelay,
      hasPaymentHistory: record.totalInvoices > 0,
      daysUntilDue,
    },
  };
}

export async function search(query: string): Promise<SearchResponse> {
  const term = query.trim().toLowerCase();
  if (term.length < 2) return { invoices: [], customers: [] };
  const [invoices, records] = await Promise.all([loadInvoices(), loadCustomerRecords()]);
  const invoiceMatches = invoices
    .filter((invoice) =>
      `${invoice.id} ${invoice.customerName} ${invoice.customerId}`.toLowerCase().includes(term),
    )
    .slice(0, 6);
  const customerMatches = records
    .filter((customer) => `${customer.id} ${customer.name}`.toLowerCase().includes(term))
    .slice(0, 5)
    .map((customer) => ({ id: customer.id, name: customer.name, clusterId: customer.clusterId }));
  return { invoices: invoiceMatches, customers: customerMatches };
}

export async function predictLatePayment(): Promise<never> {
  throw new IntegrationPendingError(
    "Late-payment inference is not available in demo mode. Connect the FastAPI inference endpoint to score new invoices.",
  );
}

export async function predictPaymentDelay(): Promise<never> {
  throw new IntegrationPendingError(
    "Payment-delay inference is not available in demo mode. Connect the FastAPI inference endpoint to score new invoices.",
  );
}

export async function getReportInvoices(params: InvoiceListParams) {
  const probe = await listInvoices({ ...params, page: 1, pageSize: 1 });
  if (probe.total === 0) return probe;
  return listInvoices({ ...params, page: 1, pageSize: probe.total });
}

export async function getDemoManifest() {
  return fetchJson<{
    generatedAt: string;
    mode: string;
    source: string;
    counts: Record<string, number>;
    notes: string[];
    sources: string[];
  }>("manifest.json");
}
