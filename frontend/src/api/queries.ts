import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/api";
import type { CustomerListParams, InvoiceListParams } from "@/types";

export const queryKeys = {
  dashboard: ["dashboard"] as const,
  invoices: (params: InvoiceListParams) => ["invoices", params] as const,
  invoice: (id: string) => ["invoice", id] as const,
  customers: (params: CustomerListParams) => ["customers", params] as const,
  customer: (id: string) => ["customer", id] as const,
  segments: ["segments"] as const,
  risk: ["risk"] as const,
  delay: ["delay"] as const,
  modelMetrics: ["model-metrics"] as const,
  insights: ["insights"] as const,
  dataQuality: ["data-quality"] as const,
  datasets: ["datasets"] as const,
  health: ["health"] as const,
  search: (query: string) => ["search", query] as const,
};

export function useDashboard() {
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: api.dashboard,
    staleTime: 5 * 60_000,
  });
}

export function useInvoices(params: InvoiceListParams) {
  return useQuery({
    queryKey: queryKeys.invoices(params),
    queryFn: () => api.invoices(params),
    placeholderData: keepPreviousData,
    staleTime: 2 * 60_000,
  });
}

export function useInvoice(invoiceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.invoice(invoiceId ?? ""),
    queryFn: () => api.invoice(invoiceId!),
    enabled: Boolean(invoiceId),
    staleTime: 5 * 60_000,
  });
}

export function useCustomers(params: CustomerListParams) {
  return useQuery({
    queryKey: queryKeys.customers(params),
    queryFn: () => api.customers(params),
    placeholderData: keepPreviousData,
    staleTime: 2 * 60_000,
  });
}

export function useCustomer(customerId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.customer(customerId ?? ""),
    queryFn: () => api.customer(customerId!),
    enabled: Boolean(customerId),
    staleTime: 5 * 60_000,
  });
}

export function useSegments() {
  return useQuery({ queryKey: queryKeys.segments, queryFn: api.segments, staleTime: 10 * 60_000 });
}

export function useRisk() {
  return useQuery({ queryKey: queryKeys.risk, queryFn: api.risk, staleTime: 5 * 60_000 });
}

export function useDelay() {
  return useQuery({ queryKey: queryKeys.delay, queryFn: api.delay, staleTime: 5 * 60_000 });
}

export function useModelMetrics() {
  return useQuery({ queryKey: queryKeys.modelMetrics, queryFn: api.modelMetrics, staleTime: 10 * 60_000 });
}

export function useInsights() {
  return useQuery({ queryKey: queryKeys.insights, queryFn: api.insights, staleTime: 10 * 60_000 });
}

export function useDataQuality() {
  return useQuery({ queryKey: queryKeys.dataQuality, queryFn: api.dataQuality, staleTime: 10 * 60_000 });
}

export function useDatasets() {
  return useQuery({ queryKey: queryKeys.datasets, queryFn: api.datasets, staleTime: 10 * 60_000 });
}

export function useHealth() {
  return useQuery({ queryKey: queryKeys.health, queryFn: api.health, staleTime: 60_000 });
}

export function useGlobalSearch(query: string) {
  return useQuery({
    queryKey: queryKeys.search(query),
    queryFn: () => api.search(query),
    enabled: query.trim().length >= 2,
    staleTime: 60_000,
  });
}
