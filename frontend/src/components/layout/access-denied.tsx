import { Link } from "react-router-dom";
import { ArrowLeft, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ROLE_LABELS } from "@/lib/constants";
import { useAuthStore } from "@/stores/auth";

export function AccessDenied() {
  const user = useAuthStore((state) => state.user);
  return (
    <Card className="mx-auto mt-6 max-w-xl p-8 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-risk-high-soft text-risk-high">
        <ShieldX className="h-5 w-5" />
      </div>
      <h2 className="text-lg font-semibold text-foreground">This area is restricted</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Your current role{user ? ` (${ROLE_LABELS[user.role]})` : ""} does not include access to this page. Contact a
        workspace administrator if you need additional permissions.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button asChild>
          <Link to="/dashboard">
            <ArrowLeft className="h-4 w-4" />
            Back to overview
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/reports">Open reports</Link>
        </Button>
      </div>
    </Card>
  );
}
