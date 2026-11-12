import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface ChartCardProps {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  loading?: boolean;
  footer?: ReactNode;
}

export function ChartCard({
  title,
  description,
  action,
  children,
  className,
  contentClassName,
  loading,
  footer,
}: ChartCardProps) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 pb-3">
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription className="mt-1">{description}</CardDescription> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </CardHeader>
      <CardContent className={cn("flex-1", contentClassName)}>
        {loading ? <Skeleton className="h-full min-h-[220px] w-full" /> : children}
      </CardContent>
      {footer ? <div className="border-t border-border/70 px-5 py-3 text-xs text-muted-foreground">{footer}</div> : null}
    </Card>
  );
}
