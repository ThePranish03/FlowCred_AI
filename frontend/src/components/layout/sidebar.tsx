import { NavLink, useLocation } from "react-router-dom";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAME, APP_TAGLINE, navigateItemsForRole } from "@/lib/constants";
import { useAuthStore } from "@/stores/auth";
import { usePreferencesStore } from "@/stores/preferences";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

function isItemActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/" || pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={cn("flex items-center gap-3 px-4 py-5", collapsed && "justify-center px-2")}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
        <svg viewBox="0 0 32 32" className="h-5 w-5" fill="none" aria-hidden>
          <path
            d="M5 22c3 0 3-12 6-12s3 12 6 12 3-7 6-7 2.5 3.5 2.5 3.5"
            stroke="white"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <circle cx="5" cy="22" r="2" fill="#16A085" />
          <circle cx="25" cy="18" r="2" fill="#7EA6DD" />
        </svg>
      </span>
      {!collapsed ? (
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold tracking-tight text-white">{APP_NAME}</p>
          <p className="truncate text-[10px] font-medium uppercase tracking-[0.14em] text-white/45">AR Intelligence</p>
        </div>
      ) : null}
    </div>
  );
}

export function SidebarContent({
  collapsed,
  onNavigate,
  onToggleCollapsed,
  showCollapseToggle = true,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
  onToggleCollapsed?: () => void;
  showCollapseToggle?: boolean;
}) {
  const role = useAuthStore((state) => state.user?.role ?? "admin");
  const { pathname } = useLocation();
  const sections = navigateItemsForRole(role);

  return (
    <div className="flex h-full flex-col bg-brand-navy text-white">
      <Brand collapsed={collapsed} />
      <div className="h-px bg-white/10" />
      <nav className="flex-1 overflow-y-auto px-2.5 py-3 scrollbar-thin">
        {sections.map((section) => (
          <div key={section.label} className="mb-4 last:mb-0">
            {!collapsed ? (
              <p className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
                {section.label}
              </p>
            ) : (
              <div className="mx-auto mb-2 h-px w-6 bg-white/10" />
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isItemActive(pathname, item.href);
                const Icon = item.icon;
                const link = (
                  <NavLink
                    to={item.href}
                    onClick={onNavigate}
                    className={cn(
                      "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
                      active
                        ? "bg-white/[0.11] text-white"
                        : "text-white/65 hover:bg-white/[0.06] hover:text-white",
                      collapsed && "justify-center px-0 py-2.5",
                    )}
                    aria-current={active ? "page" : undefined}
                  >
                    {active ? (
                      <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-[#5FA8FF]" />
                    ) : null}
                    <Icon
                      className={cn(
                        "h-[17px] w-[17px] shrink-0 transition-colors",
                        active ? "text-[#8FC4FF]" : "text-white/50 group-hover:text-white/80",
                      )}
                      strokeWidth={1.9}
                    />
                    {!collapsed ? (
                      <>
                        <span className="truncate">{item.title}</span>
                        {item.badge ? (
                          <Badge
                            variant="outline"
                            className="ml-auto h-[18px] border-white/20 bg-white/5 px-1.5 text-[9px] font-semibold text-white/70"
                          >
                            {item.badge}
                          </Badge>
                        ) : null}
                      </>
                    ) : null}
                  </NavLink>
                );
                return (
                  <li key={item.href}>
                    {collapsed ? (
                      <Tooltip delayDuration={150}>
                        <TooltipTrigger asChild>{link}</TooltipTrigger>
                        <TooltipContent side="right" sideOffset={10}>
                          {item.title}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      link
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/10 p-3">
        {!collapsed ? (
          <div className="mb-2 flex items-start gap-2 rounded-lg bg-white/[0.06] px-2.5 py-2">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#8FC4FF]" />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-white/90">Three models available</p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-white/45">
                Classification, regression and clustering artifacts loaded.
              </p>
            </div>
          </div>
        ) : null}
        {showCollapseToggle ? (
          <button
            type="button"
            onClick={onToggleCollapsed}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] font-medium text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white",
              collapsed && "justify-center px-0",
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            {!collapsed ? <span>Collapse sidebar</span> : null}
          </button>
        ) : null}
        <p className={cn("mt-2 px-2.5 text-[9px] leading-relaxed text-white/25", collapsed && "hidden")}>
          {APP_TAGLINE}
        </p>
      </div>
    </div>
  );
}

export function Sidebar() {
  const collapsed = usePreferencesStore((state) => state.sidebarCollapsed);
  const toggle = usePreferencesStore((state) => state.toggleSidebar);

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-30 hidden border-r border-white/5 shadow-sidebar transition-[width] duration-300 lg:block",
        collapsed ? "w-[76px]" : "w-[264px]",
      )}
    >
      <SidebarContent collapsed={collapsed} onToggleCollapsed={toggle} />
    </aside>
  );
}
