import type { DiagnosticsCandidate } from "@/types";
import { Badge } from "@/components/ui/badge";
import { MODEL_LABELS, MODEL_NOTES } from "@/components/charts/forecast-bakeoff";
import { cn } from "@/lib/utils";

const STRENGTHS: Record<string, string> = {
  xgboost_daily: "Learns weekday structure, then sums to weeks",
  xgboost_weekly: "Handles non-linear interactions between lags",
  arima: "Explicit trend/differencing, stable on volatile series",
  ets: "Smooth level and damped trend, few parameters",
  seasonal_naive: "Zero-assumption reference",
  due_date_schedule: "Knows the contracted calendar exactly",
};

const LIMITS: Record<string, string> = {
  xgboost_daily: "Recursive daily errors can compound",
  xgboost_weekly: "Needs enough weekly history to split",
  arima: "Assumes linear structure",
  ets: "Cannot react to a regime break",
  seasonal_naive: "Blind to any pattern beyond last week",
  due_date_schedule: "Sees only invoices already issued",
};

export function AlgorithmCards({
  candidates,
  currency,
}: {
  candidates: DiagnosticsCandidate[];
  currency: "USD" | "CAD";
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {candidates.map((candidate) => {
        const weekly = candidate.scopes.weekly;
        const holdout = weekly?.holdoutWape;
        return (
          <div
            key={candidate.model}
            className={cn(
              "rounded-xl border bg-card p-4 transition-shadow",
              candidate.selected
                ? "border-brand-accent/40 ring-2 ring-brand-accent/15"
                : "border-border hover:shadow-sm",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">
                {MODEL_LABELS[candidate.model] ?? candidate.model}
              </p>
              {candidate.selected ? <Badge variant="low">Selected</Badge> : null}
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {MODEL_NOTES[candidate.model] ?? ""}
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border/70 pt-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Validation</p>
                <p className="text-sm font-semibold tabular text-foreground">
                  {weekly?.wape != null ? `${(weekly.wape * 100).toFixed(1)}%` : "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Holdout</p>
                <p className="text-sm font-semibold tabular text-foreground">
                  {holdout != null ? `${(holdout * 100).toFixed(1)}%` : "—"}
                </p>
              </div>
            </div>

            <dl className="mt-3 space-y-1 text-[11px] leading-relaxed">
              <div className="flex gap-1.5">
                <dt className="shrink-0 text-risk-low">+</dt>
                <dd className="text-muted-foreground">{STRENGTHS[candidate.model]}</dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="shrink-0 text-risk-high">−</dt>
                <dd className="text-muted-foreground">{LIMITS[candidate.model]}</dd>
              </div>
            </dl>
          </div>
        );
      })}
    </div>
  );
}
