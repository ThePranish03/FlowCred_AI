import { Compass, LayoutDashboard } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function NotFoundPage() {
  return (
    <Card className="mx-auto flex max-w-xl flex-col items-center px-6 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-soft text-primary">
        <Compass className="h-5 w-5" />
      </span>
      <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-accent">Error 404</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">This route does not exist</h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        The page you requested is not part of this workspace. Check the address or return to the executive overview.
      </p>
      <Button asChild className="mt-6">
        <Link to="/dashboard">
          <LayoutDashboard className="h-4 w-4" />
          Back to overview
        </Link>
      </Button>
    </Card>
  );
}
