import { useSearchParams } from "react-router-dom";
import { ArrowRight, Info, Lightbulb, ListChecks, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { useInsights } from "@/api/queries";
import { PageHeader } from "@/components/common/page-header";
import { InfoNote } from "@/components/common/notes";
import { ErrorState } from "@/components/common/states";
import { PageSkeleton } from "@/components/common/loading";
import { FeatureBars } from "@/components/charts/feature-bars";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { InsightsResponse } from "@/types";

type ModelKey = "late" | "delay" | "clustering";

const TAB_TO_KEY: Record<string, ModelKey> = {
  "late-payment": "late",
  "payment-delay": "delay",
  clustering: "clustering",
  late: "late",
  delay: "delay",
};

function ModelPanel({
  model,
  accent,
}: {
  model: InsightsResponse["latePayment"] | InsightsResponse["paymentDelay"] | InsightsResponse["clustering"];
  accent: string;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle>Global feature importance</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Top {Math.min(model.items.length, 12)} of {model.items.length} recorded features.
          </p>
        </CardHeader>
        <CardContent>
          <FeatureBars items={model.items} limit={12} barClassName={accent} />
          <div className="mt-5 flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>{model.explanation}</p>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Model context</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">Algorithm</span>
              <Badge variant="accent">{model.model}</Badge>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">Target</span>
              <span className="text-xs font-medium text-foreground">{model.target}</span>
            </div>
            {model.context.map((item) => (
              <div key={item.label} className="border-t border-border/60 pt-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{item.label}</p>
                <p className="mt-0.5 text-xs text-foreground">{item.value}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Explainability boundary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-teal" />
              <p>
                These rankings are global properties of the trained model. They do not attribute a specific invoice&apos;s
                score to a specific feature.
              </p>
            </div>
            <div className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-accent" />
              <p>
                Local SHAP values are not available from the supplied artifacts. When the backend exposes SHAP output, this
                page will show invoice-level contributions without estimating them in the browser.
              </p>
            </div>
            <Button variant="outline" size="sm" className="w-full" asChild>
              <Link to="/model-performance">
                <ArrowRight className="h-3.5 w-3.5" />
                Model evaluation
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function InsightsPage() {
  const { data, isLoading, isError, error, refetch } = useInsights();
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("model") ?? "late";
  const tab: ModelKey = TAB_TO_KEY[requested] ?? "late";

  if (isLoading) return <PageSkeleton />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Insights could not be loaded"
        description={error instanceof Error ? error.message : "The insights endpoint did not respond."}
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Explainability"
        title="Insights & model drivers"
        description="Understand which recorded features separate late payments, drive delay estimates and define behavioural segments. Global drivers support interpretation; they are not causal explanations."
        actions={
          <Button variant="outline" asChild>
            <Link to="/model-performance">
              Evaluation metrics
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        }
      />

      <InfoNote>
        <strong>Global, not local.</strong> {data.shap.note} Invoice-level explanations will appear only when the backend
        supplies real SHAP values; nothing is approximated here.
      </InfoNote>

      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = new URLSearchParams(searchParams);
          next.set("model", value === "late" ? "late-payment" : value === "delay" ? "payment-delay" : "clustering");
          setSearchParams(next, { replace: true });
        }}
      >
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="late">Late payment</TabsTrigger>
          <TabsTrigger value="delay">Payment delay</TabsTrigger>
          <TabsTrigger value="clustering">Segmentation</TabsTrigger>
        </TabsList>

        <TabsContent value="late">
          <ModelPanel model={data.latePayment} accent="bg-brand-accent" />
        </TabsContent>
        <TabsContent value="delay">
          <ModelPanel model={data.paymentDelay} accent="bg-brand-teal" />
        </TabsContent>
        <TabsContent value="clustering">
          <ModelPanel model={data.clustering} accent="bg-brand-navy" />
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-risk-medium" />
            Operational guidance
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Recommended interpretations derived from the recorded model outputs. These are planning guidance, not automated
            decisions.
          </p>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {data.recommendedActions.map((action, index) => (
              <li key={action} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary">
                  {index + 1}
                </span>
                <p className="text-sm leading-relaxed text-muted-foreground">{action}</p>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-risk-medium/25 bg-risk-medium-soft px-3 py-2.5 text-[11px] leading-relaxed text-[#7C4A03]">
            <ListChecks className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>
              Do not use these outputs as the sole basis for adverse customer action. Pair model signals with payment
              history, contractual context and human review.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
