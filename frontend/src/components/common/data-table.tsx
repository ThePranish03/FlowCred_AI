import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Inbox } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/states";
import { cn } from "@/lib/utils";

export interface DataTableColumn<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  sortable?: boolean;
  align?: "left" | "right" | "center";
  className?: string;
  headerClassName?: string;
}

export interface SortState {
  by: string;
  order: "asc" | "desc";
}

interface DataTableProps<T> {
  data: T[];
  columns: DataTableColumn<T>[];
  getRowId: (row: T) => string;
  loading?: boolean;
  skeletonRows?: number;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  className?: string;
  rowClassName?: (row: T) => string;
}

export function DataTable<T>({
  data,
  columns,
  getRowId,
  loading,
  skeletonRows = 8,
  sort,
  onSortChange,
  onRowClick,
  emptyTitle = "No records found",
  emptyDescription = "Adjust the filters or search term to widen the result set.",
  emptyAction,
  className,
  rowClassName,
}: DataTableProps<T>) {
  const alignClass = (align?: "left" | "right" | "center") =>
    align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";

  const handleSort = (column: DataTableColumn<T>) => {
    if (!column.sortable || !onSortChange) return;
    const isActive = sort?.by === column.id;
    onSortChange({
      by: column.id,
      order: isActive && sort?.order === "desc" ? "asc" : "desc",
    });
  };

  if (!loading && data.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
        className={className}
      />
    );
  }

  return (
    <div className={cn("overflow-hidden rounded-xl border border-border bg-card", className)}>
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => {
              const active = sort?.by === column.id;
              return (
                <TableHead
                  key={column.id}
                  className={cn(alignClass(column.align), column.headerClassName)}
                  aria-sort={active ? (sort?.order === "asc" ? "ascending" : "descending") : undefined}
                >
                  {column.sortable && onSortChange ? (
                    <button
                      type="button"
                      onClick={() => handleSort(column)}
                      className={cn(
                        "inline-flex items-center gap-1.5 transition-colors hover:text-foreground",
                        active && "text-foreground",
                      )}
                    >
                      {column.header}
                      {active ? (
                        sort?.order === "asc" ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : (
                          <ArrowDown className="h-3 w-3" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3 w-3 opacity-40" />
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading
            ? Array.from({ length: skeletonRows }).map((_, rowIndex) => (
                <TableRow key={`skeleton-${rowIndex}`}>
                  {columns.map((column) => (
                    <TableCell key={column.id} className={alignClass(column.align)}>
                      <Skeleton
                        className={cn(
                          "h-4",
                          column.align === "right" ? "ml-auto w-16" : "w-24",
                        )}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : data.map((row) => (
                <TableRow
                  key={getRowId(row)}
                  className={cn(
                    onRowClick && "cursor-pointer",
                    rowClassName?.(row),
                  )}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  role={onRowClick ? "button" : undefined}
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                >
                  {columns.map((column) => (
                    <TableCell key={column.id} className={cn(alignClass(column.align), column.className)}>
                      {column.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
        </TableBody>
      </Table>
    </div>
  );
}
