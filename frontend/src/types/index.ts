export type Role = "admin" | "business_owner" | "accountant" | "collections";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  company: string;
}

export type RiskBand = "Low" | "Medium" | "High";
export type InvoiceStatus = "paid" | "open";
export type DelayDirection = "early" | "on_time" | "late";

export interface Invoice {
  id: string;
  customerId: string;
  customerName: string;
  amount: number;
  currency: string;
  invoiceDate: string;
  dueDate: string;
  paymentDate?: string | null;
  paymentTerms: string;
  status: InvoiceStatus;
  delayDays?: number | null;
  isLate?: boolean | null;
  lateProbability?: number | null;
  riskBand?: RiskBand | null;
  predictedDelay?: number | null;
}

export interface InvoiceDetailResponse {
  invoice: Invoice;
  customer: Customer;
  clusterId: number;
  cluster: ClusterDetail;
  history: Invoice[];
  context: {
    previousAvgDelay: number | null;
    previousLateRatio: number | null;
    previousInvoiceCount: number | null;
    previousMedianDelay: number | null;
    hasPaymentHistory: boolean;
    daysUntilDue: number;
  };
}

export interface InvoiceListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  customerId?: string;
  status?: InvoiceStatus | "all";
  riskBand?: RiskBand | "all";
  dateFrom?: string;
  dateTo?: string;
  amountMin?: number;
  amountMax?: number;
  hasPrediction?: boolean;
  hasDelayPrediction?: boolean;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Customer {
  id: string;
  name: string;
  clusterId: number;
  totalInvoices: number;
  activeMonths: number;
  totalInvoiceAmount: number;
  outstandingAmount: number;
  avgInvoiceAmount: number;
  medianInvoiceAmount: number;
  paidInvoices: number;
  openInvoices: number;
  lateInvoices: number;
  onTimeInvoices: number;
  latePaymentRatio: number;
  avgPaymentDelay: number;
  medianPaymentDelay: number;
  invoiceFrequency: number;
  customerLifetimeDays: number;
  daysSinceLastInvoice: number;
  recentAvgDelay: number;
  recentLateRatio: number;
  paymentTermConsistency: number;
  lastInvoiceDate: string | null;
  scoredInvoices?: number;
  avgLateProbability?: number | null;
  highRiskInvoices?: number;
}

export interface CustomerListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  clusterId?: number | "all";
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface CustomerComparison {
  feature: string;
  label: string;
  customerValue: number;
  clusterValue: number;
  globalMedian: number;
}

export interface CustomerDetailResponse {
  customer: Customer;
  cluster: ClusterDetail;
  history: Invoice[];
  scoredInvoices: Invoice[];
  comparison: CustomerComparison[];
  risk: {
    scoredInvoices: number;
    avgProbability: number | null;
    highRiskInvoices: number;
    predictedLateInvoices: number;
    avgPredictedDelay: number | null;
    outstanding: number;
  };
}

export interface ClusterDetail {
  clusterId: number;
  customers: number;
  percentage: number;
  isSmall: boolean;
  totalInvoiceAmount: number;
  avgInvoiceAmount: number;
  avgPaymentDelay: number;
  avgLatePaymentRatio: number;
  avgInvoiceFrequency: number;
  medianInvoiceCount: number | null;
  medianCustomerLifetimeDays: number | null;
}

export interface ClusterSize {
  clusterId: number;
  customers: number;
  percentage: number;
  isSmall: boolean;
}

export interface FeatureComparison {
  feature: string;
  label: string;
  clusters: {
    clusterId: number;
    min: number | null;
    q1: number | null;
    median: number | null;
    q3: number | null;
    max: number | null;
    count: number;
  }[];
}

export interface SegmentsResponse {
  model: {
    algorithm: string;
    clusters: number;
    customers: number;
    features: number;
    randomState: number;
    nInit: number;
    silhouette: number;
    calinskiHarabasz: number;
    daviesBouldin: number;
    meanARI: number;
    minARI: number;
    maxARI: number;
  };
  sizes: ClusterDetail[];
  pca: {
    points: { customerId: string; clusterId: number; x: number; y: number }[];
    explainedVariance: number[];
    xRange: { p01: number; p99: number };
    yRange: { p01: number; p99: number };
    note: string;
  };
  heatmap: { feature: string; label: string; values: number[]; medians: number[] }[];
  featureComparison: FeatureComparison[];
  profiles: Record<string, number>[];
  stability: { comparison: string; ARI: number }[];
  modelComparison: Record<string, string | number | null>[];
  warnings: string[];
}

export interface DashboardKpis {
  totalInvoices: number;
  totalInvoiceAmount: number;
  totalOutstandingAmount: number;
  latePaymentExposure: number;
  highRiskOutstanding: number;
  highRiskInvoices: number;
  openHighRiskInvoices: number;
  averagePredictedDelay: number;
  customersAnalysed: number;
  scoredInvoices: number;
  openInvoices: number;
  paidInvoices: number;
}

export interface BandCount {
  band: RiskBand;
  count: number;
  percentage: number;
}

export interface BandExposure {
  band: RiskBand;
  invoices: number;
  openInvoices: number;
  outstanding: number;
}

export interface DistributionBucket {
  bucket: string;
  count: number;
}

export interface SegmentDistributionItem {
  clusterId: number;
  customers: number;
  percentage: number;
}

export interface MonthlyTrend {
  month: string;
  monthKey: string;
  invoices: number;
  amount: number;
  paidInvoices: number;
  openInvoices: number;
  lateInvoices: number;
  onTimeInvoices: number;
}

export interface RiskInvoiceSummary {
  id: string;
  customerId: string;
  customerName: string;
  amount: number;
  currency: string;
  invoiceDate?: string;
  dueDate: string;
  status?: InvoiceStatus;
  lateProbability: number;
  riskBand: RiskBand;
  predictedDelay: number | null;
}

export interface ModelStatusItem {
  id: string;
  name: string;
  algorithm: string;
  status: "available" | "coming_soon";
  version: string | null;
  lastTrained: string | null;
  primaryMetric: { label: string; value: number } | null;
  href: string;
}

export interface LatestPrediction {
  id: string;
  customerName: string;
  invoiceDate: string;
  amount: number;
  lateProbability: number;
  riskBand: RiskBand;
  predictedDelay: number | null;
}

export interface DashboardResponse {
  kpis: DashboardKpis;
  statusDistribution: { status: string; count: number; amount: number }[];
  riskDistribution: BandCount[];
  riskExposureByBand: BandExposure[];
  delayDistribution: DistributionBucket[];
  segmentDistribution: SegmentDistributionItem[];
  monthlyTrends: MonthlyTrend[];
  recentHighRiskInvoices: RiskInvoiceSummary[];
  recentlyAnalysedCustomers: {
    id: string;
    name: string;
    scoredInvoices: number;
    avgProbability: number;
    highRiskInvoices: number;
    lastScoredInvoice: string;
  }[];
  modelStatus: ModelStatusItem[];
  latestPredictions: LatestPrediction[];
  dataWindow: { start: string; end: string; scoredStart: string; scoredEnd: string };
  currencyNote: string;
}

export interface RiskResponse {
  bands: {
    low: { threshold: number; label: string; description: string };
    medium: { threshold: number; label: string; description: string };
    high: { threshold: number; label: string; description: string };
  };
  decisionThreshold: number;
  counts: {
    low: number;
    medium: number;
    high: number;
    openLow: number;
    openMedium: number;
    openHigh: number;
    totalScored: number;
    totalOpenScored: number;
  };
  distribution: BandCount[];
  exposureByBand: BandExposure[];
  queue: RiskInvoiceSummary[];
  customerRisk: {
    id: string;
    name: string;
    scoredInvoices: number;
    avgProbability: number;
    highRiskInvoices: number;
    totalAmount: number;
    latestInvoice: string;
  }[];
  trend: {
    month: string;
    monthKey: string;
    scored: number;
    avgProbability: number;
    highRisk: number;
    mediumRisk: number;
    outstanding: number;
  }[];
  thresholdExplanation: string;
  currencyNote: string;
}

export interface DelayResponse {
  averagePredictedDelay: number;
  medianPredictedDelay: number;
  averageActualDelay: number;
  earlyPercentage: number;
  onTimePercentage: number;
  latePercentage: number;
  counts: { early: number; onTime: number; late: number; scored: number };
  distribution: DistributionBucket[];
  customerDelay: {
    id: string;
    name: string;
    invoices: number;
    avgPredictedDelay: number;
    avgActualDelay: number | null;
    maxPredictedDelay: number;
  }[];
  metrics: { MAE: number; RMSE: number; R2: number; MedAE: number; testRows: number };
  disclaimer: string;
}

export interface FeatureImportanceItem {
  feature: string;
  label: string;
  importance: number;
}

export interface InsightsResponse {
  latePayment: {
    model: string;
    target: string;
    items: FeatureImportanceItem[];
    explanation: string;
    context: { label: string; value: string }[];
  };
  paymentDelay: {
    model: string;
    target: string;
    items: FeatureImportanceItem[];
    explanation: string;
    context: { label: string; value: string }[];
  };
  clustering: {
    model: string;
    target: string;
    items: FeatureImportanceItem[];
    explanation: string;
    context: { label: string; value: string }[];
  };
  shap: { available: boolean; note: string };
  recommendedActions: string[];
}

export interface LatePaymentModelMetrics {
  name: string;
  algorithm: string;
  target: string;
  version: string | null;
  datasetVersion: string | null;
  trainedAt: string | null;
  trainingRows: number;
  validationRows: number;
  testRows: number;
  trainingDateRange: string[];
  validationDateRange: string[];
  testDateRange: string[];
  decisionThreshold: number;
  testMetrics: {
    accuracy: number;
    precision: number;
    recall: number;
    f1: number;
    roc_auc: number;
    pr_auc: number;
  };
  operationalThresholdMetrics: {
    accuracy: number;
    precision: number;
    recall: number;
    f1: number;
    roc_auc: number;
    pr_auc: number;
  };
  validationMetrics: Record<string, number>;
  rocAuc: number;
  prAuc: number;
  rocCurve: { x: number; y: number }[];
  prCurve: { x: number; y: number }[];
  confusionMatrix: ConfusionMatrix;
  confusionMatrixDefault: ConfusionMatrix;
  thresholdAnalysis: {
    threshold: number;
    precision: number;
    recall: number;
    f1: number;
    accuracy: number;
  }[];
  featureImportance: FeatureImportanceItem[];
  modelComparison: Record<string, string | number>[];
  metricSource: string;
}

export interface ConfusionMatrix {
  threshold: number;
  trueNegative: number;
  falsePositive: number;
  falseNegative: number;
  truePositive: number;
  accuracy: number;
}

export interface PaymentDelayModelMetrics {
  name: string;
  algorithm: string;
  target: string;
  version: string | null;
  datasetVersion: string | null;
  trainedAt: string | null;
  trainingRows: number;
  validationRows: number;
  testRows: number;
  features: number;
  validationMetrics: { MAE: number; RMSE: number; R2: number; MedAE: number };
  testMetrics: { MAE: number; RMSE: number; R2: number; MedAE: number };
  selection: string;
  featureImportance: FeatureImportanceItem[];
  actualVsPredicted: { actual: number; predicted: number; absoluteError: number }[];
  residualDistribution: { bucket: string; center: number; count: number }[];
  byAmountBucket: Record<string, number | string>[];
  byCategory: Record<string, number | string>[];
  modelComparison: Record<string, number | string>[];
  metricSource: string;
}

export interface ClusteringModelMetrics {
  name: string;
  algorithm: string;
  target: string;
  version: string;
  datasetVersion: string | null;
  trainedAt: string | null;
  trainingCustomers: number;
  clusters: number;
  features: number;
  silhouette: number;
  calinskiHarabasz: number;
  daviesBouldin: number;
  stability: { mean_ARI: number; min_ARI: number; max_ARI: number; seeds: number[] };
  sizes: ClusterDetail[];
  pca: SegmentsResponse["pca"];
  modelComparison: Record<string, string | number | null>[];
  metricSource: string;
}

export interface ModelMetricsResponse {
  latePayment: LatePaymentModelMetrics;
  paymentDelay: PaymentDelayModelMetrics;
  clustering: ClusteringModelMetrics;
  methodology: { note: string; threshold: string; disclaimer: string };
}

export interface DataQualityResponse {
  dataset: string;
  totalRecords: number;
  paidRecords: number;
  openRecords: number;
  customers: number;
  dateRange: { start: string; end: string };
  duplicateInvoiceIds: number;
  invalidRecords: {
    dueBeforeInvoice: number;
    paymentBeforeInvoice: number;
    nonPositiveAmount: number;
    total: number;
  };
  missingByColumn: { column: string; missing: number }[];
  currencyCounts: Record<string, number>;
  statusCounts: Record<string, number>;
  requiredColumns: string[];
  optionalColumns: string[];
  validationRules: string[];
}

export interface DatasetsResponse {
  datasets: {
    name: string;
    rows: number;
    sizeKb: number;
    modified: string;
    stage: string;
  }[];
}

export interface HealthResponse {
  status: "demo" | "ok" | "degraded";
  mode: "demo" | "live";
  apiVersion: string;
  models: { id: string; status: string; version: string | null }[];
  timestamp: string;
}

export interface SearchResponse {
  invoices: Invoice[];
  customers: { id: string; name: string; clusterId: number }[];
}

export interface UploadValidationResult {
  fileName: string;
  sizeKb: number;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  missingValues: { column: string; missing: number }[];
  issues: { row: number; column: string; message: string }[];
  headers: string[];
  preview: Record<string, string>[];
  validatedAt: string;
}

export type ReportType =
  | "late-risk"
  | "payment-delay"
  | "segmentation"
  | "model-performance"
  | "invoice-summary";

export interface GeneratedReport {
  id: string;
  type: ReportType;
  title: string;
  generatedAt: string;
  rows: Record<string, string | number>[];
  columns: { key: string; label: string }[];
  summary: { label: string; value: string }[];
  notes: string[];
}
