import { Link } from "react-router-dom";
import {
  ArrowRight,
  CalendarClock,
  Construction,
  Layers,
  Lock,
  Sparkles,
  WalletCards,
} from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { InfoNote, SectionHeading } from "@/components/common/notes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

const PLANNED_CAPABILITIES = [
  {
    icon: CalendarClock,
    title: "Rolling collection windows",
    description:
      "Expected cash inflows across configurable 30, 60 and 90-day horizons, grouped by invoice due date and predicted delay.",
  },
  {
    icon: Layers,
    title: "Scenario bands",
    description:
      "Best, expected and conservative collection paths derived from model uncertainty — only after the backend produces calibrated interval estimates.",
  },
  {
    icon: Sparkles,
    title: "Driver attribution",
    description:
      "Contributions from risk bands, customer segments and payment terms, using recorded model evidence rather than heuristic labels.",
  },
];

const PREREQUISITES = [
  "A dedicated cash-flow model trained and validated on historical collection timing.",
  "Accurate open-invoice status and amounts, since the current scored window contains paid invoices only.",
  "An explicit FX policy for mixing USD and CAD, or separate forecasts per currency.",
  "Backtesting and calibration evidence published by the backend before any projection is displayed.",
  "A backend endpoint that returns forecast values, intervals and as-of timestamps together.",
];

export default function CashFlowForecastPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Workspace"
        title="Cash flow forecast"
        description="A planned capability for projecting expected collections. It is not available in this release, and no forecast numbers are shown."
        actions={<Badge variant="medium">Coming soon</Badge>}
      />

      <Card className="overflow-hidden">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <div className="p-6 sm:p-8">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <WalletCards className="h-6 w-6" strokeWidth={1.8} />
            </span>
            <h2 className="mt-4 text-xl font-semibold tracking-tight text-foreground">
              No forecast model has been supplied
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
              The three recorded artifacts cover late-payment probability, payment-delay days and customer segmentation.
              None of them constitutes a cash-flow forecast. Rather than invent a projection from unrelated outputs, this
              page stays explicitly unavailable until a validated forecasting model and backend endpoint exist.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button asChild>
                <Link to="/delay-predictions">
                  Explore delay predictions
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/payment-risk">Review payment risk</Link>
              </Button>
            </div>
            <div className="mt-6 flex items-start gap-2.5 rounded-lg border border-border bg-muted/25 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Any future forecast must arrive from the backend with its as-of date, horizon, assumptions and validation
                evidence. The frontend will not estimate or interpolate missing values.
              </span>
            </div>
          </div>

          <div className="relative border-t border-border bg-muted/20 p-6 lg:border-l lg:border-t-0">
            <div className="relative h-full min-h-[260px] overflow-hidden rounded-xl border border-dashed border-border bg-card">
              <div className="absolute inset-x-0 top-0 flex items-center justify-between border-b border-dashed border-border px-4 py-2.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  Planned layout
                </span>
                <Badge variant="muted">Preview disabled</Badge>
              </div>
              <div className="absolute inset-x-4 bottom-6 top-14 flex flex-col justify-between">
                {[0, 1, 2, 3].map((line) => (
                  <div key={line} className="border-t border-dashed border-border/80" />
                ))}
              </div>
              <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Construction className="h-5 w-5" />
                </span>
                <p className="mt-3 text-sm font-semibold text-foreground">No forecast data</p>
                <p className="mt-1 max-w-[240px] text-[11px] leading-relaxed text-muted-foreground">
                  This is an empty layout reference, not a projection. No amounts, dates or trend lines are implied.
                </p>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <InfoNote variant="warning">
        <strong>Integrity note.</strong> Cash-flow figures are financial commitments. Presenting estimated inflows without a
        validated model, currency policy and calibration evidence would be misleading, so this release intentionally shows
        none.
      </InfoNote>

      <div>
        <SectionHeading
          title="Planned capabilities"
          description="Scope for a future release, subject to a new model and backend contract."
          className="mb-3"
        />
        <div className="grid gap-4 md:grid-cols-3">
          {PLANNED_CAPABILITIES.map((capability) => {
            const Icon = capability.icon;
            return (
              <Card key={capability.title} className="h-full border-dashed">
                <CardHeader className="pb-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Icon className="h-4 w-4" />
                  </span>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">{capability.title}</h3>
                    <Badge variant="muted">Planned</Badge>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{capability.description}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <SectionHeading
            title="What must exist first"
            description="Checklist the backend and data team must satisfy before this page can display a forecast."
          />
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {PREREQUISITES.map((item) => (
              <li key={item} className="flex gap-2.5 rounded-lg border border-border bg-muted/20 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-accent" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-xs text-muted-foreground">
            <span>
              The endpoint contract and integration gaps are documented in Settings.
            </span>
            <Button variant="outline" size="sm" asChild>
              <Link to="/settings?tab=api">Review API integration</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
