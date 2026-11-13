import { useEffect, useState } from "react";
import { Menu, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { SidebarContent } from "@/components/layout/sidebar";
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";
import { NotificationsPopover } from "@/components/layout/notifications";
import { UserMenu } from "@/components/layout/user-menu";
import { GlobalSearchDialog } from "@/components/layout/global-search-dialog";
import { usePreferencesStore } from "@/stores/preferences";

export function Navbar() {
  const [searchOpen, setSearchOpen] = useState(false);
  const mobileOpen = usePreferencesStore((state) => state.mobileSidebarOpen);
  const setMobileOpen = usePreferencesStore((state) => state.setMobileSidebarOpen);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85">
        <div className="flex h-16 items-center gap-2 px-4 sm:px-6 lg:px-8">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <WorkspaceSwitcher className="hidden md:flex" />

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="hidden h-9 min-w-[220px] items-center gap-2 rounded-lg border border-input bg-muted/40 px-3 text-left text-xs text-muted-foreground transition-colors hover:border-brand-accent/30 hover:bg-card md:flex xl:min-w-[320px]"
            >
              <Search className="h-4 w-4" />
              <span className="flex-1">Search invoices, customers…</span>
              <kbd className="rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium">⌘K</kbd>
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setSearchOpen(true)}
              aria-label="Search"
            >
              <Search className="h-[18px] w-[18px]" />
            </Button>
            <NotificationsPopover />
            <div className="mx-1 h-6 w-px bg-border" />
            <UserMenu />
          </div>
        </div>
      </header>

      <GlobalSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[280px] p-0" hideClose={false}>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">FlowCred AI main navigation</SheetDescription>
          <SidebarContent
            collapsed={false}
            showCollapseToggle={false}
            onNavigate={() => setMobileOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
