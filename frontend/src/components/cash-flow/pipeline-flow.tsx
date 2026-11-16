import { ArrowRight, Database, Filter, GitCompareArrows, Layers, Lock, Timer } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PipelineStage {
  id: string;
  label: string;
  detail: string;
  icon: typeof Database;
}

const ICONS = [Database, Filter, Layers, GitCompareArrows, Timer, Lock];

/**
 * The study in one line: what went in, what was compared, what was frozen.
 * Every stage is hoverable so the explanation is available without a modal.
 */
export function PipelineFlow({
  stages,
}: {
  stages: { label: string; detail: string }[];
}) {
  return (
    <ol className="flex flex-col gap-2 lg:flex-row lg:items-stretch">
      {stages.map((stage, index) => {
        const Icon = ICONS[index % ICONS.length];
        return (
          <li key={stage.label} className="flex flex-1 items-center gap-2">
            <div
              className={cn(
                "group flex h-full min-w-0 flex-1 flex-col rounded-lg border border-border bg-card px-3 py-2.5",
                "transition-colors hover:border-brand-accent/40 hover:bg-brand-accent/[0.03]",
              )}
              title={stage.detail}
            >
              <span className="flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5 text-brand-accent" strokeWidth={1.9} />
                <span className="truncate text-[11px] font-semibold text-foreground">{stage.label}</span>
              </span>
              <span className="mt-1 line-clamp-2 text-[10px] leading-snug text-muted-foreground">
                {stage.detail}
              </span>
            </div>
            {index < stages.length - 1 ? (
              <ArrowRight className="hidden h-3.5 w-3.5 shrink-0 text-border lg:block" aria-hidden />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
