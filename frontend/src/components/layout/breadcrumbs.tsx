import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";

const LABELS: Record<string, string> = {
  dashboard: "Overview",
  invoices: "Invoices",
  "payment-risk": "Payment Risk",
  "delay-predictions": "Delay Predictions",
  customers: "Customers",
  "customer-segments": "Customer Segments",
  insights: "Insights & Explainability",
  "model-performance": "Model Performance",
  "data-management": "Data Management",
  reports: "Reports",
  settings: "Settings",
  "cash-flow-forecast": "Cash Flow Forecast",
};

export function Breadcrumbs() {
  const { pathname } = useLocation();
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const crumbs = segments.map((segment, index) => {
    const href = `/${segments.slice(0, index + 1).join("/")}`;
    let label = LABELS[segment] ?? segment;
    if (index === 1 && (segments[0] === "invoices" || segments[0] === "customers")) {
      label = `${segments[0] === "invoices" ? "Invoice" : "Customer"} ${decodeURIComponent(segment)}`;
    }
    return { href, label };
  });

  return (
    <nav aria-label="Breadcrumb" className="scrollbar-thin overflow-x-auto">
      <ol className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
        <li>
          <Link to="/dashboard" className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:text-foreground">
            <Home className="h-3.5 w-3.5" />
            <span className="sr-only">Dashboard</span>
          </Link>
        </li>
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <li key={crumb.href} className="flex items-center gap-1.5">
              <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
              {isLast ? (
                <span className="max-w-[260px] truncate px-1 py-0.5 font-medium text-foreground" aria-current="page">
                  {crumb.label}
                </span>
              ) : (
                <Link to={crumb.href} className="max-w-[220px] truncate rounded px-1 py-0.5 hover:text-foreground">
                  {crumb.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
