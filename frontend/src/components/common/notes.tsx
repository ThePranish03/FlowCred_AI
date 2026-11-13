import type { ReactNode } from "react";
import { Info, ShieldCheck, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export function InfoNote({
  children,
  variant = "info",
  icon,
  className,
}: {
  children: ReactNode;
  variant?: "info" | "warning" | "success";
  icon?: ReactNode;
  className?: string;
}) {
  const styles = {
    info: "border-brand-accent/20 bg-[#F1F6FD] text-brand-navy",
    warning: "border-risk-medium/25 bg-risk-medium-soft text-[#7C4A03]",
    success: "border-risk-low/20 bg-risk-low-soft text-[#166534]",
  }[variant];
  const Icon = variant === "warning" ? TriangleAlert : variant === "success" ? ShieldCheck : Info;
  return (
    <div className={cn("flex gap-2.5 rounded-lg border px-3.5 py-3 text-xs leading-relaxed", styles, className)}>
      <span className="mt-0.5 shrink-0">{icon ?? <Icon className="h-4 w-4" />}</span>
      <div className="[&_strong]:font-semibold [&_a]:underline">{children}</div>
    </div>
  );
}

export function SectionHeading({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div>
        <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
