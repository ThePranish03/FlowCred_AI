import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import {
  BellRing,
  Bot,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  Database,
  KeyRound,
  Lock,
  LogOut,
  Minus,
  RefreshCw,
  Server,
  ShieldCheck,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { useModelMetrics } from "@/api/queries";
import { PageHeader } from "@/components/common/page-header";
import { InfoNote, SectionHeading } from "@/components/common/notes";
import { ErrorState } from "@/components/common/states";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuthStore } from "@/stores/auth";
import { usePreferencesStore } from "@/stores/preferences";
import {
  ALL_ROLES,
  API_BASE_URL,
  API_MODE,
  DEMO_ENDPOINTS,
  NAV_SECTIONS,
  NOTIFICATION_PREFS_DEFAULT,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  WORKSPACES,
} from "@/lib/constants";
import { formatDate, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Role } from "@/types";

const TABS = [
  { id: "profile", label: "Profile", icon: UserRound },
  { id: "workspace", label: "Workspace", icon: Building2 },
  { id: "notifications", label: "Notifications", icon: BellRing },
  { id: "access", label: "Roles & access", icon: ShieldCheck },
  { id: "api", label: "API integration", icon: Server },
  { id: "models", label: "Models", icon: Bot },
] as const;

type TabId = (typeof TABS)[number]["id"];

const NOTIFICATION_OPTIONS: {
  key: keyof typeof NOTIFICATION_PREFS_DEFAULT;
  title: string;
  description: string;
}[] = [
  {
    key: "highRiskInvoice",
    title: "High-risk invoice alerts",
    description: "Surface invoices that cross the 70% probability band in the notification tray.",
  },
  {
    key: "weeklySummary",
    title: "Weekly receivables digest",
    description: "A Monday summary of risk movement, predicted delays and segment changes.",
  },
  {
    key: "modelDrift",
    title: "Model monitoring notices",
    description: "Warnings when recorded evaluation metrics drift beyond the documented tolerance.",
  },
  {
    key: "uploadComplete",
    title: "Dataset processing results",
    description: "Validation and ingestion outcomes when a new invoice file is uploaded.",
  },
  {
    key: "productUpdates",
    title: "Product updates",
    description: "Release notes about new analytics, exports and integrations.",
  },
];

const MISSING_INTEGRATIONS = [
  "POST /invoices/predict/late-payment — live inference from the XGBoost classifier",
  "POST /invoices/predict/payment-delay — live inference from the HistGradientBoosting regressor",
  "POST /datasets/upload — server-side validation, storage and reprocessing",
  "Authentication and SSO — current role selection is a local demo, not an identity provider",
  "Scheduled report delivery and server-side report storage",
  "Persisted cash-flow run history and approval workflow (POST /cash-flow/runs requires admin or business owner)",
];

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

const ACCESS_FEATURES = NAV_SECTIONS.flatMap((section) =>
  section.items.map((item) => ({
    section: section.label,
    title: item.title,
    href: item.href,
    roles: item.roles,
  })),
);

export default function SettingsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useAuthStore((state) => state.user);
  const updateProfile = useAuthStore((state) => state.updateProfile);
  const logout = useAuthStore((state) => state.logout);

  const company = usePreferencesStore((state) => state.company);
  const updateCompany = usePreferencesStore((state) => state.updateCompany);
  const notifications = usePreferencesStore((state) => state.notifications);
  const setNotification = usePreferencesStore((state) => state.setNotification);

  const metrics = useModelMetrics();

  const tabFromUrl = (TABS.find((entry) => entry.id === searchParams.get("tab"))?.id ?? "profile") as TabId;
  const [tab, setTab] = useState<TabId>(tabFromUrl);
  useEffect(() => setTab(tabFromUrl), [tabFromUrl]);

  const [profile, setProfile] = useState({
    name: user?.name ?? "",
    email: user?.email ?? "",
  });
  const [workspaceForm, setWorkspaceForm] = useState({ ...company });

  if (!user) return null;

  function handleTabChange(value: string) {
    const next = value as TabId;
    setTab(next);
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    setSearchParams(params, { replace: true });
  }

  function saveProfile() {
    if (!profile.name.trim()) {
      toast.error("Name cannot be empty.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email.trim())) {
      toast.error("Enter a valid email address.");
      return;
    }
    updateProfile({ name: profile.name.trim(), email: profile.email.trim() });
    toast.success("Profile updated for this demo session");
  }

  function saveWorkspace() {
    if (!workspaceForm.name.trim()) {
      toast.error("Workspace name cannot be empty.");
      return;
    }
    updateCompany({
      name: workspaceForm.name.trim(),
      industry: workspaceForm.industry.trim(),
      baseCurrency: workspaceForm.baseCurrency,
      timezone: workspaceForm.timezone.trim(),
      fiscalYear: workspaceForm.fiscalYear.trim(),
      country: workspaceForm.country.trim(),
    });
    toast.success("Workspace preferences saved");
  }

  async function copyBaseUrl() {
    try {
      await navigator.clipboard.writeText(API_BASE_URL);
      toast.success("API base URL copied");
    } catch {
      toast.error("Clipboard access was blocked by the browser");
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description="Manage your demo profile, workspace defaults, notification preferences and role access. The API contract and model status tabs document what the backend must provide."
      />

      <div className="overflow-x-auto border-b border-border">
        <Tabs value={tab} onValueChange={handleTabChange}>
          <TabsList className="h-auto w-max justify-start gap-1 bg-transparent p-0">
            {TABS.map((entry) => {
              const Icon = entry.icon;
              return (
                <TabsTrigger
                  key={entry.id}
                  value={entry.id}
                  className="gap-2 rounded-none border-b-2 border-transparent px-3 pb-2.5 pt-2 data-[state=active]:border-brand-accent data-[state=active]:bg-transparent data-[state=active]:text-brand-navy data-[state=active]:shadow-none"
                >
                  <Icon className="h-4 w-4" />
                  {entry.label}
                </TabsTrigger>
              );
            })}
          </TabsList>

          <TabsContent value="profile" className="mt-5">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
              <Card>
                <CardHeader className="pb-3">
                  <SectionHeading title="Your profile" description="Displayed in the workspace and on generated reports." />
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="profile-name">Full name</Label>
                      <Input
                        id="profile-name"
                        value={profile.name}
                        onChange={(event) => setProfile((current) => ({ ...current, name: event.target.value }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="profile-email">Email address</Label>
                      <Input
                        id="profile-email"
                        type="email"
                        value={profile.email}
                        onChange={(event) => setProfile((current) => ({ ...current, email: event.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Role</Label>
                      <div className="flex h-10 items-center rounded-lg border border-border bg-muted/40 px-3 text-sm text-foreground">
                        {ROLE_LABELS[user.role]}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Workspace</Label>
                      <div className="flex h-10 items-center rounded-lg border border-border bg-muted/40 px-3 text-sm text-foreground">
                        {user.company}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/25 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
                    The role is fixed by the demo sign-in option you selected. Real deployments should map roles from your
                    identity provider; the frontend already enforces navigation and route-level access from the session role.
                  </div>
                  <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
                    <Button onClick={saveProfile}>Save profile</Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        logout();
                        navigate("/login");
                      }}
                    >
                      <LogOut className="h-4 w-4" />
                      Sign out
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="h-fit">
                <CardContent className="flex flex-col items-center px-5 py-6 text-center">
                  <Avatar className="h-16 w-16">
                    <AvatarFallback className="bg-primary-soft text-lg font-semibold text-primary">
                      {initials(user.name)}
                    </AvatarFallback>
                  </Avatar>
                  <p className="mt-3 text-sm font-semibold text-foreground">{profile.name || user.name}</p>
                  <p className="text-xs text-muted-foreground">{profile.email || user.email}</p>
                  <Badge variant="accent" className="mt-2">
                    {ROLE_LABELS[user.role]}
                  </Badge>
                  <p className="mt-3 border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
                    {ROLE_DESCRIPTIONS[user.role]}
                  </p>
                  <div className="mt-4 w-full space-y-1.5 rounded-lg border border-border bg-muted/20 p-3 text-left">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">Session</span>
                      <span className="font-medium text-foreground">Local demo</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">API mode</span>
                      <span className="font-medium capitalize text-foreground">{API_MODE}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">User ID</span>
                      <span className="font-mono text-[10px] text-foreground">{user.id}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="workspace" className="mt-5">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
              <Card>
                <CardHeader className="pb-3">
                  <SectionHeading
                    title="Workspace defaults"
                    description="Applied to the interface and report headers in this browser."
                  />
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="workspace-name">Workspace name</Label>
                      <Input
                        id="workspace-name"
                        value={workspaceForm.name}
                        onChange={(event) =>
                          setWorkspaceForm((current) => ({ ...current, name: event.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="workspace-industry">Industry</Label>
                      <Input
                        id="workspace-industry"
                        value={workspaceForm.industry}
                        onChange={(event) =>
                          setWorkspaceForm((current) => ({ ...current, industry: event.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="workspace-country">Country</Label>
                      <Input
                        id="workspace-country"
                        value={workspaceForm.country}
                        onChange={(event) =>
                          setWorkspaceForm((current) => ({ ...current, country: event.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="workspace-currency">Display currency</Label>
                      <Select
                        id="workspace-currency"
                        value={workspaceForm.baseCurrency}
                        onChange={(event) =>
                          setWorkspaceForm((current) => ({ ...current, baseCurrency: event.target.value }))
                        }
                      >
                        <option value="USD">USD — US dollar</option>
                        <option value="CAD">CAD — Canadian dollar</option>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="workspace-timezone">Timezone</Label>
                      <Input
                        id="workspace-timezone"
                        value={workspaceForm.timezone}
                        onChange={(event) =>
                          setWorkspaceForm((current) => ({ ...current, timezone: event.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="workspace-fiscal">Fiscal year starts</Label>
                      <Select
                        id="workspace-fiscal"
                        value={workspaceForm.fiscalYear}
                        onChange={(event) =>
                          setWorkspaceForm((current) => ({ ...current, fiscalYear: event.target.value }))
                        }
                      >
                        {[
                          "January",
                          "February",
                          "March",
                          "April",
                          "May",
                          "June",
                          "July",
                          "August",
                          "September",
                          "October",
                          "November",
                          "December",
                        ].map((month) => (
                          <option key={month} value={month}>
                            {month}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>

                  <InfoNote variant="warning">
                    <strong>Display preference only.</strong> The dataset mixes USD and CAD without FX conversion. Selecting a
                    currency here changes labels, not the underlying values, and does not convert historical invoices.
                  </InfoNote>

                  <div className="flex items-center gap-2 border-t border-border pt-4">
                    <Button onClick={saveWorkspace}>Save workspace</Button>
                    <Button variant="outline" onClick={() => setWorkspaceForm({ ...company })}>
                      Reset
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-5">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Workspaces</CardTitle>
                    <p className="text-xs text-muted-foreground">This demo ships with a single evaluation workspace.</p>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {WORKSPACES.map((workspace) => (
                      <div
                        key={workspace.id}
                        className="flex items-start justify-between gap-3 rounded-lg border border-brand-accent/20 bg-[#F1F6FD] px-3.5 py-3"
                      >
                        <div>
                          <p className="text-sm font-medium text-foreground">{workspace.name}</p>
                          <p className="text-[11px] text-muted-foreground">{workspace.plan}</p>
                        </div>
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-accent" />
                      </div>
                    ))}
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      Multi-workspace creation, invitations and billing require backend tenancy support that is not part of
                      this frontend.
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Data handling</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2.5 text-[11px] leading-relaxed text-muted-foreground">
                    <p className="flex gap-2">
                      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-accent" />
                      Settings, profile and notification choices are stored in this browser only. Clearing site storage
                      resets them.
                    </p>
                    <p className="flex gap-2">
                      <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-accent" />
                      No API keys, database credentials or model files belong in frontend configuration or browser storage.
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="notifications" className="mt-5">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
              <Card>
                <CardHeader className="pb-3">
                  <SectionHeading
                    title="Notification preferences"
                    description="Choose which events should appear in the notification tray."
                  />
                </CardHeader>
                <CardContent className="divide-y divide-border">
                  {NOTIFICATION_OPTIONS.map((option) => (
                    <div key={option.key} className="flex items-start justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{option.title}</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{option.description}</p>
                      </div>
                      <Switch
                        checked={notifications[option.key]}
                        onCheckedChange={(checked) => {
                          setNotification(option.key, checked);
                          toast.success(`${option.title} ${checked ? "enabled" : "disabled"}`);
                        }}
                        aria-label={option.title}
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>

              <div className="space-y-5">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Delivery channels</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-xs">
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3.5 py-3">
                      <div>
                        <p className="font-medium text-foreground">In-app tray</p>
                        <p className="text-[11px] text-muted-foreground">Active · generated from recorded data</p>
                      </div>
                      <Badge variant="low">Enabled</Badge>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3.5 py-3 opacity-70">
                      <div>
                        <p className="font-medium text-foreground">Email digest</p>
                        <p className="text-[11px] text-muted-foreground">Requires backend mail delivery</p>
                      </div>
                      <Badge variant="muted">Not connected</Badge>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3.5 py-3 opacity-70">
                      <div>
                        <p className="font-medium text-foreground">Webhooks</p>
                        <p className="text-[11px] text-muted-foreground">Requires event pipeline and signing secret</p>
                      </div>
                      <Badge variant="muted">Not connected</Badge>
                    </div>
                    <InfoNote>
                      Preferences are saved locally. No email, SMS or webhook will be sent until those integrations exist.
                    </InfoNote>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="access" className="mt-5">
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {ALL_ROLES.map((role: Role) => (
                  <Card key={role} className={cn(user.role === role && "border-brand-accent/40 ring-1 ring-brand-accent/10")}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-foreground">{ROLE_LABELS[role]}</p>
                        {user.role === role ? <Badge variant="accent">You</Badge> : null}
                      </div>
                      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card>
                <CardHeader className="pb-3">
                  <SectionHeading
                    title="Navigation access matrix"
                    description="Both the sidebar and route guards use the same role lists, so a hidden link cannot be opened directly."
                  />
                </CardHeader>
                <CardContent className="px-0 pb-0">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-left text-xs">
                      <thead className="border-y border-border bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-5 py-2.5 font-semibold">Feature</th>
                          {ALL_ROLES.map((role) => (
                            <th key={role} className="px-3 py-2.5 text-center font-semibold">
                              {ROLE_LABELS[role]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {ACCESS_FEATURES.map((feature) => (
                          <tr key={feature.href} className="border-b border-border/70 last:border-0">
                            <td className="px-5 py-2.5">
                              <p className="font-medium text-foreground">{feature.title}</p>
                              <p className="font-mono text-[10px] text-muted-foreground">{feature.href}</p>
                            </td>
                            {ALL_ROLES.map((role) => (
                              <td key={role} className="px-3 py-2.5 text-center">
                                {feature.roles.includes(role) ? (
                                  <Check className="mx-auto h-3.5 w-3.5 text-risk-low" aria-label="Allowed" />
                                ) : (
                                  <Minus className="mx-auto h-3.5 w-3.5 text-muted-foreground/50" aria-label="Blocked" />
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              <InfoNote variant="warning">
                <strong>Demo authentication.</strong> The login screen maps a role to a local profile; there is no password
                verification, session token or server-side authorisation. Production access control must be enforced by the
                backend, not only in the UI.
              </InfoNote>
            </div>
          </TabsContent>

          <TabsContent value="api" className="mt-5">
            <div className="space-y-5">
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-base">Current connection</CardTitle>
                        <p className="text-xs text-muted-foreground">Selected through Vite environment variables.</p>
                      </div>
                      <Badge variant={API_MODE === "live" ? "low" : "accent"}>
                        {API_MODE === "live" ? "Live backend" : "Demo adapter"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/25 px-3.5 py-3">
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                          API base URL
                        </p>
                        <code className="mt-0.5 block truncate text-xs text-foreground">{API_BASE_URL}</code>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => void copyBaseUrl()}>
                        <Copy className="h-3.5 w-3.5" />
                        Copy
                      </Button>
                    </div>

                    <div>
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        Switch to the backend
                      </p>
                      <pre className="overflow-x-auto rounded-lg border border-border bg-[#0F1E33] px-4 py-3 text-[11px] leading-relaxed text-[#D7E3F4]">
{`# .env.local
VITE_API_MODE=live
VITE_API_BASE_URL=http://localhost:8000/api/v1`}
                      </pre>
                      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                        Rebuild after changing environment variables. The live client applies the base URL to every request
                        and expects JSON responses that match the types in <code>src/types/index.ts</code>.
                      </p>
                    </div>

                    <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-3">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Adapter</p>
                        <p className="mt-0.5 text-xs text-foreground">src/api/demo.ts</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Live client</p>
                        <p className="mt-0.5 text-xs text-foreground">src/api/client.ts</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Swap point</p>
                        <p className="mt-0.5 text-xs text-foreground">src/api/index.ts</p>
                      </div>
                    </div>

                    <InfoNote variant="warning">
                      <strong>Never put secrets in this app.</strong> Model files, API keys and database credentials stay on
                      the backend. Inference must run server-side; the browser only sends invoice fields and receives scores.
                    </InfoNote>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Missing integrations</CardTitle>
                    <p className="text-xs text-muted-foreground">Documented gaps, not simulated behaviour.</p>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2.5">
                      {MISSING_INTEGRATIONS.map((item) => (
                        <li key={item} className="flex gap-2 text-[11px] leading-relaxed text-muted-foreground">
                          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-risk-medium" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-muted/25 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                      <Database className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      Demo fixtures are generated from the recorded ML artifacts and are read-only.
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="pb-3">
                  <SectionHeading
                    title="Endpoint contract"
                    description="The frontend consumes these paths. Paths marked pending require backend implementation."
                  />
                </CardHeader>
                <CardContent className="px-0 pb-0">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[680px] text-left text-xs">
                      <thead className="border-y border-border bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-5 py-2.5 font-semibold">Method</th>
                          <th className="px-3 py-2.5 font-semibold">Path</th>
                          <th className="px-3 py-2.5 font-semibold">Demo behaviour</th>
                          <th className="px-5 py-2.5 text-right font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {DEMO_ENDPOINTS.map((endpoint) => {
                          const pending = endpoint.demo.toLowerCase().includes("pending");
                          return (
                            <tr key={`${endpoint.method}-${endpoint.path}`} className="border-b border-border/70 last:border-0">
                              <td className="px-5 py-2.5">
                                <Badge variant={endpoint.method === "POST" ? "teal" : "accent"} className="font-mono text-[10px]">
                                  {endpoint.method}
                                </Badge>
                              </td>
                              <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] text-foreground">
                                {endpoint.path}
                              </td>
                              <td className="px-3 py-2.5 text-muted-foreground">{endpoint.demo}</td>
                              <td className="px-5 py-2.5 text-right">
                                <Badge variant={pending ? "medium" : "low"}>{pending ? "Pending backend" : "Demo ready"}</Badge>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-5 lg:grid-cols-2">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Response expectations</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-[11px] leading-relaxed text-muted-foreground">
                    <p>• Dates use ISO format (YYYY-MM-DD); timestamps are ISO 8601 with timezone.</p>
                    <p>• Probabilities are fractions between 0 and 1, not percentages.</p>
                    <p>• Delay values are signed days: negative early, positive late, zero on time.</p>
                    <p>• Paginated lists return items, page, pageSize, total and totalPages.</p>
                    <p>• Monetary values are returned in their original currency with the currency code alongside.</p>
                    <p>• Unscored invoices return null for probability and predicted delay rather than a placeholder score.</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Operational requirements</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-[11px] leading-relaxed text-muted-foreground">
                    <p>• Serve the SPA and API on the same origin, or configure explicit CORS origins.</p>
                    <p>• Load model artifacts on the server at startup; never ship joblib files to the browser.</p>
                    <p>• Apply authentication and role checks server-side for every route.</p>
                    <p>• Keep raw invoice payloads out of logs and third-party analytics.</p>
                    <p>• Return recorded SHAP values only when the backend computes them; do not synthesise explanations.</p>
                    <p>• Expose a health endpoint with model versions so this page can report availability.</p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="models" className="mt-5">
            {metrics.isLoading ? (
              <div className="grid gap-4 md:grid-cols-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Card key={index}>
                    <CardContent className="space-y-3 p-5">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-28" />
                      <Skeleton className="h-16 w-full" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : metrics.isError ? (
              <ErrorState
                title="Model metadata could not be loaded"
                description={metrics.error instanceof Error ? metrics.error.message : "The metrics endpoint did not respond."}
                onRetry={() => metrics.refetch()}
              />
            ) : metrics.data ? (
              <div className="space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <CardTitle className="text-base">Late-payment classifier</CardTitle>
                          <p className="text-xs text-muted-foreground">
                            {metrics.data.latePayment.algorithm} · {metrics.data.latePayment.target}
                          </p>
                        </div>
                        <Badge variant="low">Available</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div>
                          <p className="text-muted-foreground">Decision threshold</p>
                          <p className="mt-0.5 font-semibold text-foreground">
                            {formatPercent(metrics.data.latePayment.decisionThreshold, true, 0)}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Test ROC AUC</p>
                          <p className="mt-0.5 font-semibold text-foreground">
                            {metrics.data.latePayment.testMetrics.roc_auc.toFixed(3)}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Test PR AUC</p>
                          <p className="mt-0.5 font-semibold text-foreground">
                            {metrics.data.latePayment.testMetrics.pr_auc.toFixed(3)}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Test rows</p>
                          <p className="mt-0.5 font-semibold text-foreground">
                            {formatNumber(metrics.data.latePayment.testRows)}
                          </p>
                        </div>
                      </div>
                      <div className="border-t border-border pt-3 text-[11px] text-muted-foreground">
                        Version {metrics.data.latePayment.version ?? "recorded artifact"} · last trained{" "}
                        {formatDate(metrics.data.latePayment.trainedAt)}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <CardTitle className="text-base">Payment-delay regressor</CardTitle>
                          <p className="text-xs text-muted-foreground">
                            {metrics.data.paymentDelay.algorithm} · {metrics.data.paymentDelay.target}
                          </p>
                        </div>
                        <Badge variant="low">Available</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div>
                          <p className="text-muted-foreground">Test MAE</p>
                          <p className="mt-0.5 font-semibold text-foreground">
                            {metrics.data.paymentDelay.testMetrics.MAE.toFixed(2)} days
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Test R²</p>
                          <p className="mt-0.5 font-semibold text-foreground">
                            {metrics.data.paymentDelay.testMetrics.R2.toFixed(3)}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Features</p>
                          <p className="mt-0.5 font-semibold text-foreground">
                            {formatNumber(metrics.data.paymentDelay.features)}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Test rows</p>
                          <p className="mt-0.5 font-semibold text-foreground">
                            {formatNumber(metrics.data.paymentDelay.testRows)}
                          </p>
                        </div>
                      </div>
                      <div className="border-t border-border pt-3 text-[11px] text-muted-foreground">
                        Version {metrics.data.paymentDelay.version ?? "recorded artifact"} · last trained{" "}
                        {formatDate(metrics.data.paymentDelay.trainedAt)}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <CardTitle className="text-base">Customer segmentation</CardTitle>
                          <p className="text-xs text-muted-foreground">
                            {metrics.data.clustering.algorithm} · {metrics.data.clustering.target}
                          </p>
                        </div>
                        <Badge variant="low">Available</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div>
                          <p className="text-muted-foreground">Clusters</p>
                          <p className="mt-0.5 font-semibold text-foreground">{metrics.data.clustering.clusters}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Silhouette</p>
                          <p className="mt-0.5 font-semibold text-foreground">
                            {metrics.data.clustering.silhouette.toFixed(4)}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Customers</p>
                          <p className="mt-0.5 font-semibold text-foreground">
                            {formatNumber(metrics.data.clustering.trainingCustomers)}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Mean ARI</p>
                          <p className="mt-0.5 font-semibold text-foreground">
                            {metrics.data.clustering.stability.mean_ARI.toFixed(4)}
                          </p>
                        </div>
                      </div>
                      <div className="border-t border-border pt-3 text-[11px] text-muted-foreground">
                        Version {metrics.data.clustering.version} · last trained{" "}
                        {formatDate(metrics.data.clustering.trainedAt)}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <CardTitle className="text-base">Cash-flow forecaster</CardTitle>
                          <p className="text-xs text-muted-foreground">
                            Weekly collection forecast · invoice-clearance proxy
                          </p>
                        </div>
                        <Badge variant="low">Available</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 text-[11px] leading-relaxed text-muted-foreground">
                      <p>
                        Model 4 forecasts weekly collections per currency with independent USD and CAD pipelines and
                        derived daily estimates. Validation used chronological rolling-origin folds; MAPE is never
                        reported because zero-collection periods exist.
                      </p>
                      <p>
                        Forecasting readiness is reported separately from the three-model health gate, so a missing
                        forecast artifact never degrades the core product.
                      </p>
                      <Button variant="outline" size="sm" asChild>
                        <Link to="/cash-flow-forecast">Open forecast dashboard</Link>
                      </Button>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader className="pb-3">
                    <SectionHeading
                      title="Fixed model configuration"
                      description="Read-only settings derived from the supplied artifacts."
                    />
                  </CardHeader>
                  <CardContent className="grid gap-4 text-[11px] leading-relaxed text-muted-foreground sm:grid-cols-2">
                    <div className="rounded-lg border border-border bg-muted/20 p-3.5">
                      <p className="mb-1 font-semibold text-foreground">Late-payment threshold and bands</p>
                      <p>
                        Decision threshold 45%. Bands are presentation groupings: Low &lt; 30%, Medium 30–70%, High ≥ 70%.
                        Changing them changes how lists are filtered, not the underlying classifier.
                      </p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/20 p-3.5">
                      <p className="mb-1 font-semibold text-foreground">Segmentation choice</p>
                      <p>
                        K-Means with K=6 is the recorded modelling choice. Silhouette peaks at K=2, while K=6 was selected for
                        operational granularity; see the clustering methodology for the full trade-off.
                      </p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/20 p-3.5">
                      <p className="mb-1 font-semibold text-foreground">No retraining from the UI</p>
                      <p>
                        The frontend cannot retrain, replace or tune the supplied models. Any model change must happen in the
                        backend training pipeline and be published as a new artifact version.
                      </p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/20 p-3.5">
                      <p className="mb-1 font-semibold text-foreground">Explainability boundary</p>
                      <p>
                        Global feature importance describes the model overall. Per-invoice SHAP values are shown only when the
                        backend supplies them; this demo does not estimate them.
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground shadow-card">
                  <span className="flex items-center gap-2">
                    <RefreshCw className="h-3.5 w-3.5" />
                    Full curves, confusion matrices and algorithm comparisons live on Model Performance.
                  </span>
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/model-performance">Open model performance</Link>
                  </Button>
                </div>
              </div>
            ) : null}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
