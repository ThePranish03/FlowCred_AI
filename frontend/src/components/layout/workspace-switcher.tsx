import { Check, ChevronsUpDown, Building2, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WORKSPACES } from "@/lib/constants";
import { usePreferencesStore } from "@/stores/preferences";
import { cn } from "@/lib/utils";

export function WorkspaceSwitcher({ className }: { className?: string }) {
  const workspaceId = usePreferencesStore((state) => state.workspaceId);
  const setWorkspace = usePreferencesStore((state) => state.setWorkspace);
  const current = WORKSPACES.find((workspace) => workspace.id === workspaceId) ?? WORKSPACES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:bg-muted",
            className,
          )}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-soft text-primary">
            <Building2 className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Workspace
            </span>
            <span className="block max-w-[190px] truncate text-[13px] font-medium text-foreground">
              {current.name}
            </span>
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[280px]">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {WORKSPACES.map((workspace) => (
          <DropdownMenuItem key={workspace.id} onSelect={() => setWorkspace(workspace.id)}>
            <Building2 />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{workspace.name}</span>
              <span className="block text-[11px] text-muted-foreground">{workspace.plan}</span>
            </span>
            {workspace.id === current.id ? <Check className="!text-brand-accent" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <Plus />
          <span>
            Add workspace
            <span className="block text-[10px] text-muted-foreground">Requires backend identity</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
