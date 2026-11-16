import type { CashFlowResearch } from "@/types";
import { Badge } from "@/components/ui/badge";
import { formatPercent } from "@/lib/format";

function verdictVariant(verdict: string) {
  if (verdict.startsWith("improved")) return "low" as const;
  if (verdict.startsWith("worsened")) return "high" as const;
  return "muted" as const;
}

/**
 * Experiments A–E in one place. These are recorded research results, not
 * production claims: the note under the table says so explicitly.
 */
export function ResearchPanel({ research }: { research: CashFlowResearch }) {
  const experiments = research.experiments ?? [];
  const mlp = research.mlp;
  const augmentation = research.augmentation;
  const transition = research.transition;

  return (
    <div className="space-y-4">
      <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {experiments.map((experiment) => (
          <li key={experiment.id} className="rounded-lg border border-border bg-muted/20 p-3">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded bg-brand-accent/10 text-[11px] font-semibold text-brand-accent">
                {experiment.id}
              </span>
              <span className="text-[11px] font-semibold leading-tight text-foreground">{experiment.question}</span>
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">{experiment.detail}</p>
          </li>
        ))}
      </ol>

      <div className="grid gap-3 lg:grid-cols-2">
        {mlp ? (
          <div className="rounded-lg border border-border p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              D · MLP synthetic pretraining
            </p>
            <table className="mt-2 w-full text-[11px]">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="font-medium">Currency</th>
                  <th className="text-right font-medium">Real-only</th>
                  <th className="text-right font-medium">Pretrained</th>
                  <th className="text-right font-medium">Change</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {Object.entries(mlp).map(([currency, row]) => (
                  <tr key={currency} className="border-t border-border/60">
                    <td className="py-1.5">{currency}</td>
                    <td className="py-1.5 text-right">{(row.realOnly * 100).toFixed(1)}%</td>
                    <td className="py-1.5 text-right">{(row.pretrained * 100).toFixed(1)}%</td>
                    <td className="py-1.5 text-right text-risk-low">
                      {formatPercent(row.relative, true)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
              Pretraining improved the neural model but it never beat the shipped one, so it stayed
              experimental.
            </p>
          </div>
        ) : null}

        {augmentation ? (
          <div className="rounded-lg border border-border p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              E · Augmentation by algorithm
            </p>
            <table className="mt-2 w-full text-[11px]">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="font-medium">Candidate</th>
                  <th className="text-right font-medium">USD</th>
                  <th className="text-right font-medium">CAD</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(augmentation.USD ?? {}).map((label) => (
                  <tr key={label} className="border-t border-border/60">
                    <td className="py-1.5 pr-2 text-muted-foreground">{label}</td>
                    <td className="py-1.5 text-right">
                      <VerdictCell row={augmentation.USD?.[label]} />
                    </td>
                    <td className="py-1.5 text-right">
                      <VerdictCell row={augmentation.CAD?.[label]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {transition ? (
              <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                Seam check — USD {transition.USD?.ratio?.toFixed(2)}×, CAD{" "}
                {transition.CAD?.ratio?.toFixed(2)}× a typical weekly move. Where the seam is large, the
                hybrid gain is treated as inconclusive.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Synthetic data is simulated. These experiments test the pipeline; they are not evidence about
        real collection behaviour, and none of them changed the production model.
      </p>
    </div>
  );
}

function VerdictCell({ row }: { row?: { verdict: string; relative_improvement: number } }) {
  if (!row) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="tabular text-muted-foreground">{formatPercent(row.relative_improvement, true)}</span>
      <Badge variant={verdictVariant(row.verdict)} className="px-1.5 py-0 text-[10px]">
        {row.verdict === "no material change" ? "no change" : row.verdict}
      </Badge>
    </span>
  );
}
