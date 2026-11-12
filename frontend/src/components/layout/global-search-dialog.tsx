import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, FileText, Loader2, Search, Users } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useGlobalSearch } from "@/api/queries";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatCurrency, formatDate } from "@/lib/format";
import { RiskBadge } from "@/components/common/badges";

export function GlobalSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 250);
  const inputRef = useRef<HTMLInputElement>(null);
  const { data, isFetching } = useGlobalSearch(open ? debounced : "");
  const hasResults = Boolean(data && (data.invoices.length || data.customers.length));

  useEffect(() => {
    if (!open) {
      setQuery("");
    } else {
      const timer = setTimeout(() => inputRef.current?.focus(), 80);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const go = (path: string) => {
    onOpenChange(false);
    navigate(path);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-0 p-0" hideClose>
        <DialogHeader className="sr-only">
          <DialogTitle>Search FlowCred</DialogTitle>
          <DialogDescription>Search invoices and customers.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search invoice ID, customer name or customer ID…"
            className="h-14 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
          />
          {isFetching ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
          <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-block">
            ESC
          </kbd>
        </div>
        <div className="max-h-[420px] overflow-y-auto p-2 scrollbar-thin">
          {query.trim().length < 2 ? (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">
              Enter at least two characters to search the invoice ledger and customer directory.
            </p>
          ) : !hasResults && !isFetching ? (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">
              No invoices or customers matched “{query.trim()}”.
            </p>
          ) : null}

          {data?.customers.length ? (
            <div className="mb-1">
              <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Customers
              </p>
              {data.customers.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  onClick={() => go(`/customers/${encodeURIComponent(customer.id)}`)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-soft text-primary">
                    <Users className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{customer.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {customer.id} · Cluster {customer.clusterId}
                    </span>
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              ))}
            </div>
          ) : null}

          {data?.invoices.length ? (
            <div>
              <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Invoices
              </p>
              {data.invoices.map((invoice) => (
                <button
                  key={invoice.id}
                  type="button"
                  onClick={() => go(`/invoices/${encodeURIComponent(invoice.id)}`)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <FileText className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {invoice.customerName}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {invoice.id} · {formatDate(invoice.invoiceDate)} · {formatCurrency(invoice.amount, invoice.currency)}
                    </span>
                  </span>
                  <RiskBadge band={invoice.riskBand} />
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
          <span>Demo adapter searches the full fixture ledger.</span>
          <span>⌘K to open · Esc to close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
