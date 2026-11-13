import type { ElementType, ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const TONES = {
  default: "bg-primary-soft text-primary",
  accent: "bg-[#EAF1FB] text-brand-accent",
  teal: "bg-[#E7F6F2] text-brand-teal",
  risk: "bg-risk-high-soft text-risk-high",
  warning: "bg-risk-medium-soft text-risk-medium",
  success: "bg-risk-low-soft text-risk-low",
} as const;

export interface KpiCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: ElementType;
  tone?: keyof typeof TONES;
  loading?: boolean;
  className?: string;
  protectedValue?: boolean;
}

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  loading,
  className,
  protectedValue,
}: KpiCardProps) {
  return (
    <Card className={cn("relative overflow-hidden p-5", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
          {loading ? (
            <Skeleton className="mt-3 h-8 w-28" />
          ) : (
            <p
              className={cn(
                "mt-2 truncate text-2xl font-semibold tracking-tight text-foreground tabular xl:text-[1.75rem]",
                protectedValue && "blur-[3px] select-none",
              )}
              title={typeof value === "string" ? value : undefined}
            >
              {value}
            </p>
          )}
          {hint ? (
            loading ? (
              <Skeleton className="mt-2 h-3 w-36" />
            ) : (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{hint}</p>
            )
          ) : null}
        </div>
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", TONES[tone])}>
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
        </span>
      </div>
    </Card>
  );
}
