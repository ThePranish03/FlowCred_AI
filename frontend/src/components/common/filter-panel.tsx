import { useState, type ReactNode } from "react";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface FilterPanelProps {
  children: ReactNode;
  onClear?: () => void;
  activeCount?: number;
  className?: string;
  title?: string;
}

export function FilterPanel({
  children,
  onClear,
  activeCount = 0,
  className,
  title = "Filters",
}: FilterPanelProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("rounded-xl border border-border bg-card p-4 shadow-card", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
          {title}
          {activeCount > 0 ? (
            <Badge variant="accent" className="h-5 px-1.5 text-[10px]">
              {activeCount} active
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {onClear && activeCount > 0 ? (
            <Button variant="ghost" size="sm" onClick={onClear}>
              <RotateCcw className="h-3.5 w-3.5" />
              Clear
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="md:hidden"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Hide" : "Show"}
          </Button>
        </div>
      </div>
      <div className={cn("mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4", open ? "grid" : "hidden md:grid")}>
        {children}
      </div>
    </div>
  );
}

export function FilterField({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
