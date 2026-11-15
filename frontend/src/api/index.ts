import { API_MODE } from "@/lib/constants";
import type {
  CashFlowForecastParams,
  CashFlowForecastResponse,
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
} from "@/types";
import { request } from "./client";
import * as demo from "./demo";

const isDemo = API_MODE === "demo";

export interface PredictionInput {
  invoice: Record<string, unknown>;
  customerHistory?: Record<string, unknown>;
}

export interface LatePaymentPrediction {
  probability: number;
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

  cashFlowForecast: (params: CashFlowForecastParams = {}): Promise<CashFlowForecastResponse> =>
    isDemo
      ? demo.getCashFlowForecast(params)
      : request({ url: "/cash-flow/forecast", params }),

  modelMetrics: (): Promise<ModelMetricsResponse> =>
    isDemo ? demo.getModelMetrics() : request({ url: "/models/metrics" }),

  insights: (): Promise<InsightsResponse> =>
    isDemo ? demo.getInsights() : request({ url: "/insights" }),

  dataQuality: (): Promise<DataQualityResponse> =>
    isDemo ? demo.getDataQuality() : request({ url: "/datasets/quality" }),

  datasets: (): Promise<DatasetsResponse> =>
    isDemo ? demo.getDatasets() : request({ url: "/datasets" }),

  health: (): Promise<HealthResponse> =>
    isDemo ? demo.getHealth() : request({ url: "/health" }),

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
