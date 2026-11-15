import { API_MODE } from "@/lib/constants";
import type {
  CustomerDetailResponse,
  CustomerListParams,
  DashboardResponse,
  DataQualityResponse,
  DatasetsResponse,
  DelayResponse,
  HealthResponse,
  InsightsResponse,
  InvoiceDetailResponse,
  InvoiceListParams,
  ModelMetricsResponse,
  Paginated,
  RiskResponse,
  SearchResponse,
  SegmentsResponse,
  Customer,
  Invoice,
  CapabilitiesResponse,
  SessionUser,
} from "@/types";
import { http, request } from "./client";
import * as demo from "./demo";

const isDemo = API_MODE === "demo";

export interface PredictionInput {
  invoice: Record<string, unknown>;
  customerHistory?: Record<string, unknown>;
}

export interface LatePaymentPrediction {
  probability: number;
  predictedLate: boolean;
  riskBand: "Low" | "Medium" | "High";
  threshold: number;
  modelVersion: string;
  predictedAt: string;
}

export interface PaymentDelayPrediction {
  predictedDelayDays: number;
  interpretation: "early" | "on_time" | "late";
  modelVersion: string;
  predictedAt: string;
}

export interface DatasetUploadResponse {
  fileName: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  issues: { row: number; column: string; message: string }[];
  validationDate: string;
  uploadStatus: "imported";
  scoringStatus: "queued" | "queue_failed";
  importedInvoices: number;
  importedCustomers: number;
  customersCreated: number;
  customersReused: number;
  rejectedRows: number;
  scoringJob: ScoringJobResponse | null;
  scoringError: string | null;
}

export interface ScoringJobResponse {
  id: string;
  status: "queued" | "running" | "completed" | "completed_with_errors" | "failed";
  total: number;
  processed: number;
  succeeded: number;
  skipped: number;
  failed: number;
  progressPercent: number;
  results: {
    successful?: { invoiceId: string; probability: number | null; predictedLate: boolean | null; riskBand: string | null; predictedDelayDays: number | null; lateModelVersion?: string; delayModelVersion?: string; predictedAt?: string }[];
    skippedInvoices?: { invoiceId: string; reason: string }[];
    failures?: { invoiceId?: string; reason: string }[];
    rescore?: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export const api = {
  mode: API_MODE,

  dashboard: (): Promise<DashboardResponse> =>
    isDemo ? demo.getDashboard() : request({ url: "/dashboard/summary" }),

  invoices: (params: InvoiceListParams = {}): Promise<Paginated<Invoice>> =>
    isDemo ? demo.listInvoices(params) : request({ url: "/invoices", params }),

  invoice: (invoiceId: string): Promise<InvoiceDetailResponse> =>
    isDemo
      ? demo.getInvoiceDetail(invoiceId)
      : request({ url: `/invoices/${encodeURIComponent(invoiceId)}` }),

  customers: (params: CustomerListParams = {}): Promise<Paginated<Customer>> =>
    isDemo ? demo.listCustomers(params) : request({ url: "/customers", params }),

  customer: (customerId: string): Promise<CustomerDetailResponse> =>
    isDemo
      ? demo.getCustomerDetail(customerId)
      : request({ url: `/customers/${encodeURIComponent(customerId)}` }),

  segments: (): Promise<SegmentsResponse> =>
    isDemo ? demo.getSegments() : request({ url: "/customers/segments" }),

  risk: (): Promise<RiskResponse> =>
    isDemo ? demo.getRiskSummary() : request({ url: "/payment-risk/summary" }),

  delay: (): Promise<DelayResponse> =>
    isDemo ? demo.getDelaySummary() : request({ url: "/delay-predictions/summary" }),

  modelMetrics: (): Promise<ModelMetricsResponse> =>
    isDemo ? demo.getModelMetrics() : request({ url: "/models/metrics" }),

  insights: (): Promise<InsightsResponse> =>
    isDemo ? demo.getInsights() : request({ url: "/insights" }),

  dataQuality: (): Promise<DataQualityResponse> =>
    isDemo ? demo.getDataQuality() : request({ url: "/datasets/quality" }),

  datasets: (): Promise<DatasetsResponse> =>
    isDemo ? demo.getDatasets() : request({ url: "/datasets" }),

  health: async (signal?: AbortSignal): Promise<HealthResponse> => {
    if (isDemo) return demo.getHealth();
    const response = await http.get<HealthResponse>("/health", { signal, timeout: 5_000, validateStatus: (status) => status < 600 });
    const data = response.data;
    if (response.status < 200 || response.status >= 300 && response.status !== 503) throw new Error(`Health check failed (${response.status}).`);
    if (!data || !["ok", "degraded"].includes(data.status) || data.mode !== "live" || typeof data.timestamp !== "string" || !Array.isArray(data.models) || !data.database) {
      throw new Error("Health endpoint returned an invalid response.");
    }
    return data;
  },

  capabilities: (): Promise<CapabilitiesResponse> =>
    isDemo
      ? Promise.resolve({ checkedAt: new Date().toISOString(), endpoints: [], authentication: { jwt: "not_active", sso: "not_configured" }, reports: { scheduledDelivery: "not_implemented", serverStorage: "not_implemented" } })
      : request({ url: "/capabilities", timeout: 5_000 }),

  currentUser: (): Promise<SessionUser> => request({ url: "/auth/me" }),

  uploadDataset: (file: File, onProgress?: (percent: number) => void): Promise<DatasetUploadResponse> => {
    const body = new FormData();
    body.append("file", file);
    return request({ method: "POST", url: "/datasets/upload", data: body, onUploadProgress: (event) => { if (event.total) onProgress?.(Math.round(event.loaded * 100 / event.total)); } });
  },

  startBulkScoring: (rescore = false): Promise<ScoringJobResponse> =>
    request({ method: "POST", url: "/datasets/scoring-jobs", data: { rescore } }),

  scoringJob: (jobId: string): Promise<ScoringJobResponse> =>
    request({ url: `/datasets/scoring-jobs/${encodeURIComponent(jobId)}` }),

  search: (query: string): Promise<SearchResponse> =>
    isDemo ? demo.search(query) : request({ url: "/search", params: { q: query } }),

  predictLatePayment: (input: PredictionInput): Promise<LatePaymentPrediction> =>
    isDemo
      ? (demo.predictLatePayment() as Promise<LatePaymentPrediction>)
      : request({ method: "POST", url: "/invoices/predict/late-payment", data: input }),

  predictPaymentDelay: (input: PredictionInput): Promise<PaymentDelayPrediction> =>
    isDemo
      ? (demo.predictPaymentDelay() as Promise<PaymentDelayPrediction>)
      : request({ method: "POST", url: "/invoices/predict/payment-delay", data: input }),

  reportInvoices: async (params: InvoiceListParams): Promise<Paginated<Invoice>> => {
    if (isDemo) return demo.getReportInvoices(params);
    const pageSize = 1000;
    const first = await request<Paginated<Invoice>>({
      url: "/invoices",
      params: { ...params, page: 1, pageSize },
    });
    if (first.totalPages <= 1) return first;
    const remaining: Paginated<Invoice>[] = [];
    const concurrency = 5;
    for (let start = 2; start <= first.totalPages; start += concurrency) {
      const batch = Array.from(
        { length: Math.min(concurrency, first.totalPages - start + 1) },
        (_, index) => start + index,
      );
      remaining.push(
        ...(await Promise.all(
          batch.map((page) =>
            request<Paginated<Invoice>>({ url: "/invoices", params: { ...params, page, pageSize } }),
          ),
        )),
      );
    }
    return {
      ...first,
      items: [first, ...remaining].flatMap((entry) => entry.items),
      page: 1,
      pageSize: first.total,
      totalPages: 1,
    };
  },
};

export { IntegrationPendingError } from "./demo";
export const demoManifest = demo.getDemoManifest;
