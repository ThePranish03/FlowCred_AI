import type { DiagnosticsCandidate, DiagnosticsScope } from "@/types";
import { cn } from "@/lib/utils";

const SCOPE_LABELS: Record<DiagnosticsScope, string> = {
  weekly: "Weekly path",
  h7: "7-day total",
  h30: "30-day total",
  h90: "90-day total",
};

const LABELS: Record<string, string> = {
  xgboost_daily: "XGBoost · daily → weekly",
  xgboost_weekly: "XGBoost · weekly direct",
  arima: "ARIMA",
  ets: "Exponential smoothing",
  seasonal_naive: "Seasonal-naive",
  due_date_schedule: "Due-date schedule",
};

const NOTES: Record<string, string> = {
  xgboost_daily: "Daily structure rolled into weekly totals",
  xgboost_weekly: "Weekly lags and calendar terms",
  arima: "Low-order linear time series",
  ets: "Damped trend, no seasonal term",
  seasonal_naive: "Repeat the last observed week",
  due_date_schedule: "Sums the open invoice book",
};

const BASELINES = new Set(["seasonal_naive", "due_date_schedule"]);

export function ForecastBakeoff({
  candidates,
  scope,
  onScopeChange,
  scopes,
  metric,
}: {
  candidates: DiagnosticsCandidate[];
  scope: DiagnosticsScope;
  onScopeChange: (scope: DiagnosticsScope) => void;
  scopes: DiagnosticsScope[];
  metric: "wape" | "holdout";
}) {
  const rows = candidates
    .map((candidate) => {
      const m = candidate.scopes[scope];
      const value = metric === "wape" ? m?.wape : m?.holdoutWape;
      return { ...candidate, value: typeof value === "number" ? value : null };
    })
    .filter((row) => row.value !== null)
    .sort((a, b) => (a.value ?? 0) - (b.value ?? 0));

  const worst = Math.max(...rows.map((r) => r.value ?? 0), 0.0001);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Evaluation scope" className="flex flex-wrap gap-1 rounded-lg bg-muted/60 p-1">
          {scopes.map((value) => (
            <button
              key={value}
              role="tab"
              aria-selected={scope === value}
              onClick={() => onScopeChange(value)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                scope === value
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {SCOPE_LABELS[value]}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Shorter bar is better · labels show {metric === "wape" ? "validation" : "holdout"} WAPE
        </p>
      </div>

      <ul className="space-y-2.5">
        {rows.map((row) => {
          const pct = ((row.value ?? 0) / worst) * 100;
          const isBaseline = BASELINES.has(row.model);
          return (
            <li key={row.model} className="group grid grid-cols-[minmax(0,190px)_1fr_auto] items-center gap-3">
              <div className="min-w-0">
                <p className={cn("truncate text-xs font-medium", row.selected ? "text-foreground" : "text-muted-foreground")}>
                  {LABELS[row.model] ?? row.model}
                </p>
                <p className="truncate text-[10px] text-muted-foreground/80">{NOTES[row.model] ?? "Baseline"}</p>
              </div>
              <div className="relative h-7">
                <div className="absolute inset-y-1.5 left-0 right-0 rounded-full bg-muted/50" />
                <div
                  className={cn(
                    "absolute inset-y-1.5 left-0 rounded-full transition-[width] duration-500 ease-out",
                    row.selected ? "bg-brand-accent" : isBaseline ? "bg-slate-400/70" : "bg-brand-accent/35",
                  )}
                  style={{ width: `${Math.max(pct, 2)}%` }}
                />
                {row.selected ? (
                  <span className="absolute inset-y-1.5 right-0 w-[3px] rounded-full bg-risk-low" aria-hidden />
                ) : null}
              </div>
              <div className="flex w-[92px] flex-col items-end">
                <span className="text-sm font-semibold tabular text-foreground">
                  {(row.value ?? 0) <= 1 ? `${((row.value ?? 0) * 100).toFixed(1)}%` : (row.value ?? 0).toFixed(3)}
                </span>
                <span className="text-[10px] tabular text-muted-foreground">
                  {row.selected ? "selected" : `${row.originsBeatingNaive}/26 origins`}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export { SCOPE_LABELS, LABELS as MODEL_LABELS, NOTES as MODEL_NOTES };
