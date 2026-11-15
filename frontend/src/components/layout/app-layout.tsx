import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Suspense } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Navbar } from "@/components/layout/navbar";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { DemoModeBanner } from "@/components/layout/demo-banner";
import { AccessDenied } from "@/components/layout/access-denied";
import { PageSkeleton } from "@/components/common/loading";
import { useAuthStore } from "@/stores/auth";
import { usePreferencesStore } from "@/stores/preferences";
import { canAccessPath, API_MODE } from "@/lib/constants";
import { cn } from "@/lib/utils";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [pathname]);
  return null;
}

export function AppLayout() {
  const user = useAuthStore((state) => state.user);
  const collapsed = usePreferencesStore((state) => state.sidebarCollapsed);
  const location = useLocation();
  const allowed = user ? canAccessPath(user.role, location.pathname) : false;

  return (
    <div className="min-h-screen bg-background">
      <ScrollToTop />
      <Sidebar />
      <div
        className={cn(
          "flex min-h-screen flex-col transition-[padding-left] duration-300",
          collapsed ? "lg:pl-[76px]" : "lg:pl-[264px]",
        )}
      >
        <DemoModeBanner />
        <Navbar />
        <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-5 sm:px-6 lg:px-8">
          <Breadcrumbs />
          <div className="mt-4">
            <Suspense fallback={<PageSkeleton />}>
              {allowed ? <Outlet /> : <AccessDenied />}
            </Suspense>
          </div>
        </main>
        <footer className="border-t border-border/70 px-4 py-4 sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <p>
              <span className="font-semibold text-foreground">FlowCred AI</span> · Explainable Accounts Receivable
              Intelligence
            </p>
            <p>
              {API_MODE === "demo"
                ? "Demo fixtures generated from recorded model artifacts · No FX conversion applied"
                : "Live backend responses · No FX conversion applied"}
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
