import {
  BarChart3,
  BellRing,
  Bot,
  Building2,
  Database,
  FileBarChart,
  Gauge,
  LayoutDashboard,
  LineChart,
  Settings,
  Sparkles,
  TrendingUp,
  Users,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/types";

export const APP_NAME = "FlowCred AI";
export const APP_TAGLINE = "Explainable Accounts Receivable Intelligence System";

export const ALL_ROLES: Role[] = ["business_owner", "accountant", "collection_user"];

export const ROLE_LABELS: Record<Role, string> = {
  business_owner: "Business Owner",
  accountant: "Accountant",
  collection_user: "Collections User",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  business_owner: "Workspace ownership, analytics, owner-only data imports, model monitoring and settings.",
  accountant: "Receivables analytics, customer intelligence and reporting.",
  collection_user: "Intended for assigned overdue work; invoice assignment and follow-up tools are not implemented yet.",
};

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  roles: Role[];
  badge?: string;
  description: string;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

const ANALYTICS_ROLES: Role[] = ["business_owner", "accountant"];
const INTELLIGENCE_ROLES: Role[] = ["business_owner", "accountant"];
const MODEL_ROLES: Role[] = ["business_owner"];
const WORKSPACE_ROLES: Role[] = ["business_owner"];

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Analytics",
    items: [
      {
        title: "Overview",
        href: "/dashboard",
        icon: LayoutDashboard,
        roles: ANALYTICS_ROLES,
        description: "Executive dashboard",
      },
      {
        title: "Invoices",
        href: "/invoices",
        icon: FileBarChart,
        roles: ANALYTICS_ROLES,
        description: "Portfolio invoice ledger",
      },
      {
        title: "Payment Risk",
        href: "/payment-risk",
        icon: Gauge,
        roles: ANALYTICS_ROLES,
        description: "Late-payment risk monitor",
      },
      {
        title: "Delay Predictions",
        href: "/delay-predictions",
        icon: TrendingUp,
        roles: ANALYTICS_ROLES,
        description: "Signed delay estimates",
      },
    ],
  },
  {
    label: "Customer intelligence",
    items: [
      {
        title: "Customers",
        href: "/customers",
        icon: Users,
        roles: ANALYTICS_ROLES,
        description: "Customer directory",
      },
      {
        title: "Customer Segments",
        href: "/customer-segments",
        icon: BarChart3,
        roles: INTELLIGENCE_ROLES,
        description: "Behavioural clusters",
      },
      {
        title: "Insights & Explainability",
        href: "/insights",
        icon: Sparkles,
        roles: INTELLIGENCE_ROLES,
        description: "Model drivers and context",
      },
    ],
  },
  {
    label: "Models & data",
    items: [
      {
        title: "Model Performance",
        href: "/model-performance",
        icon: Bot,
        roles: MODEL_ROLES,
        description: "Evaluation and monitoring",
      },
      {
        title: "Data Management",
        href: "/data-management",
        icon: Database,
        roles: MODEL_ROLES,
        description: "CSV validation and inventories",
      },
    ],
  },
  {
    label: "Workspace",
    items: [
      {
        title: "Reports",
        href: "/reports",
        icon: LineChart,
        roles: ANALYTICS_ROLES,
        description: "Generate and export reports",
      },
      {
        title: "Cash Flow Forecast",
        href: "/cash-flow-forecast",
        icon: WalletCards,
        roles: ANALYTICS_ROLES,
        description: "Weekly collection forecast with backtest evidence",
      },
      {
        title: "Settings",
        href: "/settings",
        icon: Settings,
        roles: WORKSPACE_ROLES,
        description: "Workspace and model settings",
      },
    ],
  },
];

const PATH_ROLES: { prefix: string; roles: Role[] }[] = [
  { prefix: "/dashboard", roles: ANALYTICS_ROLES },
  { prefix: "/invoices", roles: ANALYTICS_ROLES },
  { prefix: "/payment-risk", roles: ANALYTICS_ROLES },
  { prefix: "/delay-predictions", roles: ANALYTICS_ROLES },
  { prefix: "/customers", roles: ANALYTICS_ROLES },
  { prefix: "/customer-segments", roles: INTELLIGENCE_ROLES },
  { prefix: "/insights", roles: INTELLIGENCE_ROLES },
  { prefix: "/model-performance", roles: MODEL_ROLES },
  { prefix: "/data-management", roles: MODEL_ROLES },
  { prefix: "/reports", roles: ANALYTICS_ROLES },
  { prefix: "/settings", roles: WORKSPACE_ROLES },
  { prefix: "/cash-flow-forecast", roles: ANALYTICS_ROLES },
];

export function canAccessPath(role: Role, pathname: string) {
  const match = PATH_ROLES.filter((entry) => pathname.startsWith(entry.prefix)).sort(
    (a, b) => b.prefix.length - a.prefix.length,
  )[0];
  if (!match) return true;
  return match.roles.includes(role);
}

export function navigateItemsForRole(role: Role) {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => item.roles.includes(role)),
  })).filter((section) => section.items.length > 0);
}

export const CHART_COLORS = {
  navy: "#123B67",
  accent: "#2675D8",
  teal: "#16A085",
  amber: "#D97706",
  red: "#DC2626",
  slate: "#94A3B8",
  sky: "#7EA6DD",
  pale: "#DCE6F4",
  grid: "#E7ECF4",
  axis: "#667085",
};

export const CLUSTER_COLORS = [
  "#123B67",
  "#2675D8",
  "#16A085",
  "#7EA6DD",
  "#8FA3BF",
  "#C2A46B",
];

export const RISK_CONFIG = {
  Low: {
    label: "Low risk",
    text: "text-risk-low",
    bg: "bg-risk-low-soft",
    border: "border-risk-low/20",
    dot: "bg-risk-low",
    hex: "#15803D",
    range: "< 30%",
  },
  Medium: {
    label: "Medium risk",
    text: "text-risk-medium",
    bg: "bg-risk-medium-soft",
    border: "border-risk-medium/25",
    dot: "bg-risk-medium",
    hex: "#B45309",
    range: "30% – 70%",
  },
  High: {
    label: "High risk",
    text: "text-risk-high",
    bg: "bg-risk-high-soft",
    border: "border-risk-high/20",
    dot: "bg-risk-high",
    hex: "#DC2626",
    range: "≥ 70%",
  },
} as const;

export const STATUS_CONFIG = {
  paid: {
    label: "Paid",
    dot: "bg-risk-low",
    text: "text-risk-low",
    bg: "bg-risk-low-soft",
    border: "border-risk-low/20",
  },
  open: {
    label: "Open",
    dot: "bg-brand-accent",
    text: "text-brand-accent",
    bg: "bg-primary-soft",
    border: "border-brand-accent/20",
  },
  overdue: {
    label: "Overdue",
    dot: "bg-risk-medium",
    text: "text-risk-medium",
    bg: "bg-risk-medium-soft",
    border: "border-risk-medium/20",
  },
} as const;

export const API_MODE = (import.meta.env.VITE_API_MODE ?? "demo") as "demo" | "live";
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

export const DEMO_ENDPOINTS = [
  { method: "GET", path: "/dashboard/summary", demo: "Static aggregate from fixtures" },
  { method: "GET", path: "/invoices", demo: "Filtered and paginated locally" },
  { method: "GET", path: "/invoices/{invoice_id}", demo: "Fixture lookup + history context" },
  { method: "GET", path: "/customers", demo: "Filtered and paginated locally" },
  { method: "GET", path: "/customers/{customer_id}", demo: "Profile, history and cluster comparison" },
  { method: "GET", path: "/customers/segments", demo: "Cluster metrics and PCA coordinates" },
  { method: "GET", path: "/payment-risk/summary", demo: "Recorded risk summary" },
  { method: "GET", path: "/delay-predictions/summary", demo: "Recorded delay summary" },
  { method: "GET", path: "/cash-flow/forecast", demo: "Generated from the shipped forecast artifact" },
  { method: "GET", path: "/cash-flow/health", demo: "Forecast-only readiness object" },
  { method: "POST", path: "/cash-flow/runs", demo: "Persists a forecast run on the backend" },
  { method: "GET", path: "/models/metrics", demo: "Recorded metrics and recomputed curves" },
  { method: "GET", path: "/insights", demo: "Recorded global feature importance" },
  { method: "GET", path: "/datasets/quality", demo: "Recorded dataset quality profile" },
  { method: "GET", path: "/datasets", demo: "Dataset and artifact inventory" },
  { method: "GET", path: "/search?q=", demo: "Invoice and customer search" },
  { method: "POST", path: "/invoices/predict/late-payment", demo: "Live classifier inference" },
  { method: "POST", path: "/invoices/predict/payment-delay", demo: "Live delay inference" },
  { method: "POST", path: "/datasets/upload", demo: "Authenticated CSV validation and persistence" },
  { method: "GET", path: "/health", demo: "Demo status object" },
];

export const WORKSPACES = [
  { id: "flowcred-demo", name: "FlowCred Demo Workspace", plan: "Enterprise evaluation" },
];

export const MODEL_CARDS = [
  {
    id: "late-payment",
    name: "Late-Payment Classifier",
    algorithm: "XGBoost",
    icon: Gauge,
  },
  {
    id: "payment-delay",
    name: "Payment-Delay Regressor",
    algorithm: "HistGradientBoosting",
    icon: TrendingUp,
  },
  {
    id: "clustering",
    name: "Customer Behaviour Segments",
    algorithm: "K-Means · K=6",
    icon: Users,
  },
] as const;

export const COMPANY_DEFAULT = {
  name: "FlowCred Demo Workspace",
  industry: "Financial services",
  baseCurrency: "USD",
  timezone: "UTC",
  fiscalYear: "January",
  country: "United States",
};

export const NOTIFICATION_PREFS_DEFAULT = {
  highRiskInvoice: true,
  weeklySummary: true,
  modelDrift: true,
  uploadComplete: false,
  productUpdates: false,
};

export const ENTERPRISE_LINKS = [
  { label: "Workspace", icon: Building2, href: "/settings" },
  { label: "Model monitoring", icon: Bot, href: "/model-performance" },
  { label: "Notifications", icon: BellRing, href: "/settings?tab=notifications" },
];
