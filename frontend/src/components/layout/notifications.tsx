import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Bot, CheckCheck, FlaskConical, ServerOff, WalletCards } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { usePreferencesStore } from "@/stores/preferences";
import { cn } from "@/lib/utils";

const NOTIFICATIONS = [
  {
    id: "demo-mode",
    title: "Demo fixtures are active",
    description: "Dashboard values are generated from the recorded model artifacts, not live inference.",
    icon: FlaskConical,
    tone: "bg-[#EAF1FB] text-brand-accent",
  },
  {
    id: "models-loaded",
    title: "Three model artifacts available",
    description: "Late-payment, payment-delay and customer clustering metadata are loaded.",
    icon: Bot,
    tone: "bg-[#E7F6F2] text-brand-teal",
  },
  {
    id: "backend-pending",
    title: "Backend integration pending",
    description: "New-invoice inference and CSV uploads will activate when the API is connected.",
    icon: ServerOff,
    tone: "bg-risk-medium-soft text-risk-medium",
  },
  {
    id: "cashflow",
    title: "Cash-flow forecast unavailable",
    description: "The supplied project has no trained forecasting artifact. The page shows planned scope only.",
    icon: WalletCards,
    tone: "bg-muted text-muted-foreground",
  },
];

export function NotificationsPopover() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const readIds = usePreferencesStore((state) => state.readNotificationIds);
  const markRead = usePreferencesStore((state) => state.markNotificationsRead);
  const unread = NOTIFICATIONS.filter((item) => !readIds.includes(item.id)).length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications (${unread} unread)`}>
          <Bell className="h-[18px] w-[18px]" />
          {unread > 0 ? (
            <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-risk-high px-1 text-[9px] font-bold text-white">
              {unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-sm font-semibold">System notices</p>
            <p className="text-[11px] text-muted-foreground">{unread} unread · demo workspace</p>
          </div>
          {unread > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => markRead(NOTIFICATIONS.map((item) => item.id))}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </Button>
          ) : null}
        </div>
        <div className="max-h-[380px] overflow-y-auto scrollbar-thin">
          {NOTIFICATIONS.map((item) => {
            const Icon = item.icon;
            const isRead = readIds.includes(item.id);
            return (
              <button
                type="button"
                key={item.id}
                onClick={() => {
                  markRead([item.id]);
                  if (item.id === "backend-pending") navigate("/settings?tab=api");
                  if (item.id === "cashflow") navigate("/cash-flow-forecast");
                  if (item.id === "models-loaded") navigate("/model-performance");
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-start gap-3 border-b border-border/60 px-4 py-3 text-left transition-colors last:border-0 hover:bg-muted/60",
                  !isRead && "bg-[#F7FAFF]",
                )}
              >
                <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", item.tone)}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground">{item.title}</span>
                    {!isRead ? <span className="h-1.5 w-1.5 rounded-full bg-brand-accent" /> : null}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                    {item.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
