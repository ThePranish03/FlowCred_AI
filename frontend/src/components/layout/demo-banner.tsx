import { FlaskConical, Settings2 } from "lucide-react";
import { Link } from "react-router-dom";
import { API_MODE } from "@/lib/constants";

export function DemoModeBanner() {
  if (API_MODE !== "demo") return null;
  return (
    <div className="border-b border-brand-accent/15 bg-[#EEF4FC]">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs sm:px-6 lg:px-8">
        <div className="flex items-start gap-2 text-brand-navy">
          <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-accent" />
          <p>
            <span className="font-semibold">Demo data mode.</span>{" "}
            <span className="text-brand-navy/80">
              Values are served from fixtures generated from the trained model artifacts. Live inference, uploads and
              exports run through the backend once it is connected.
            </span>
          </p>
        </div>
        <Link
          to="/settings?tab=api"
          className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium text-brand-accent hover:underline"
        >
          <Settings2 className="h-3.5 w-3.5" />
          Integration contract
        </Link>
      </div>
    </div>
  );
}
