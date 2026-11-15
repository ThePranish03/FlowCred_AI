import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ArrowRight,
  BarChart3,
  Eye,
  EyeOff,
  Gauge,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { API_MODE, APP_NAME, APP_TAGLINE, ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/constants";
import { demoProfileForRole, useAuthStore } from "@/stores/auth";
import { http } from "@/api/client";
import type { Role } from "@/types";
import { cn } from "@/lib/utils";

const schema = z.object({
  email: z.string().trim().email("Enter a valid work email."),
  password: z.string().min(API_MODE === "live" ? 8 : 6, `Password must be at least ${API_MODE === "live" ? 8 : 6} characters.`),
  role: z.enum(["business_owner", "accountant", "collection_user"]).optional(),
});

type FormValues = z.infer<typeof schema>;

const CAPABILITIES = [
  {
    icon: Gauge,
    title: "Late-payment classification",
    description: "XGBoost probability, operational risk bands and the configured decision threshold.",
  },
  {
    icon: TrendingUp,
    title: "Payment-delay regression",
    description: "Signed day estimates from HistGradientBoosting — early, on-time or late.",
  },
  {
    icon: Users,
    title: "Customer behaviour segments",
    description: "Six K-Means clusters with explicit warnings about imbalanced group sizes.",
  },
];

const ROLE_OPTIONS: Role[] = ["business_owner", "accountant", "collection_user"];

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const login = useAuthStore((state) => state.login);
  const setSession = useAuthStore((state) => state.setSession);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: API_MODE === "demo" ? "owner@flowcred.ai" : "",
      password: API_MODE === "demo" ? "flowcred-demo" : "",
      role: API_MODE === "demo" ? "business_owner" : undefined,
    },
  });

  const selectedRole = form.watch("role");
  const from = (location.state as { from?: string } | null)?.from ?? "/dashboard";

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  const onSubmit = async (values: FormValues) => {
    if (API_MODE === "live") {
      try {
        const { data } = await http.post("/auth/login", { email: values.email, password: values.password });
        setSession(data.user, data.accessToken, data.refreshToken);
        toast.success(`Signed in as ${ROLE_LABELS[data.user.role as Role] ?? data.user.role}`);
        navigate(from, { replace: true });
      } catch (error: any) {
        toast.error(error?.message ?? "Unable to sign in. Check your account and password.");
      }
      return;
    }
    const role = values.role ?? "accountant";
    login(role, values.email);
    toast.success(`Signed in as ${ROLE_LABELS[role]}`, {
      description: "Demo authentication is stored locally in this browser.",
    });
    navigate(from, { replace: true });
  };

  const chooseRole = (role: Role) => {
    form.setValue("role", role, { shouldValidate: true });
    form.setValue("email", demoProfileForRole(role).email, { shouldValidate: true });
  };

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-brand-navy p-10 text-white lg:flex xl:p-14">
        <div className="absolute inset-0 opacity-[0.05]" aria-hidden>
          <svg viewBox="0 0 800 800" className="h-full w-full">
            <defs>
              <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
                <path d="M 48 0 L 0 0 0 48" fill="none" stroke="white" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        </div>

        <div className="relative">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
              <svg viewBox="0 0 32 32" className="h-6 w-6" fill="none" aria-hidden>
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
            <div>
              <p className="text-lg font-bold tracking-tight">{APP_NAME}</p>
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/45">
                Receivables Intelligence
              </p>
            </div>
          </div>

          <div className="mt-20 max-w-xl">
            <Badge className="border-white/15 bg-white/10 text-white/80 hover:bg-white/10">
              <Sparkles className="h-3 w-3" />
              Three trained models · Explainable by design
            </Badge>
            <h1 className="mt-5 text-balance text-4xl font-semibold leading-[1.15] tracking-tight xl:text-[2.75rem]">
              Clarity on every receivable, from invoice to cash.
            </h1>
            <p className="mt-4 max-w-lg text-sm leading-relaxed text-white/60">
              Score late-payment risk, estimate signed payment delays and understand customer payment behaviour without
              collapsing three different questions into one opaque score.
            </p>
          </div>

          <div className="mt-12 space-y-4">
            {CAPABILITIES.map((capability) => {
              const Icon = capability.icon;
              return (
                <div key={capability.title} className="flex items-start gap-3.5">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.07] ring-1 ring-white/10">
                    <Icon className="h-4 w-4 text-[#8FC4FF]" />
                  </span>
                  <div>
                    <p className="text-[13px] font-semibold text-white/90">{capability.title}</p>
                    <p className="mt-0.5 max-w-md text-xs leading-relaxed text-white/45">{capability.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="relative mt-12 flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] text-white/40">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" />
            Role-based access
          </span>
          <span className="inline-flex items-center gap-1.5">
            <BarChart3 className="h-3.5 w-3.5" />
            Recorded evaluation metrics
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            Six customer behaviour segments
          </span>
        </div>
      </div>

      <div className="flex flex-col justify-center px-5 py-10 sm:px-10 lg:px-14">
        <div className="mx-auto w-full max-w-[420px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-navy">
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
            <div>
              <p className="text-base font-bold text-foreground">{APP_NAME}</p>
              <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{APP_TAGLINE}</p>
            </div>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-accent">Workspace access</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Sign in to FlowCred AI</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {API_MODE === "demo"
                ? "Use a demo role to explore the application with local demo authentication."
                : "Sign in with your registered account. Your access role is managed by the backend."}
            </p>
          </div>

          {API_MODE === "demo" ? <div className="mt-6 grid grid-cols-2 gap-2">
            {ROLE_OPTIONS.map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => chooseRole(role)}
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-left transition-colors",
                  selectedRole === role
                    ? "border-brand-accent/50 bg-primary-soft ring-1 ring-brand-accent/20"
                    : "border-border bg-card hover:border-brand-accent/30 hover:bg-muted/50",
                )}
              >
                <span className={cn("block text-xs font-semibold", selectedRole === role ? "text-primary" : "text-foreground")}>
                  {ROLE_LABELS[role]}
                </span>
                <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                  {ROLE_DESCRIPTIONS[role]}
                </span>
              </button>
            ))}
          </div> : null}

          <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Work email</Label>
              <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
              {form.formState.errors.email ? (
                <p className="text-xs text-risk-high">{form.formState.errors.email.message}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  className="pr-10"
                  {...form.register("password")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-muted"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {form.formState.errors.password ? (
                <p className="text-xs text-risk-high">{form.formState.errors.password.message}</p>
              ) : null}
            </div>
            {API_MODE === "demo" ? <div className="space-y-1.5">
              <Label htmlFor="role">Access role</Label>
              <Select id="role" {...form.register("role")}>
                {ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </Select>
            </div> : null}

            <Button type="submit" className="mt-2 w-full" size="lg">
              Continue to workspace
              <ArrowRight className="h-4 w-4" />
            </Button>
          </form>

          <div className="mt-6 rounded-lg border border-border bg-muted/40 px-3.5 py-3 text-[11px] leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">{API_MODE === "demo" ? "Demo authentication." : "Live authentication."}</span>{" "}
            {API_MODE === "demo"
              ? "Any valid email and a six-character password signs you in locally. Choose a role to preview access."
              : "Use your registered email and password. The backend applies your account role to every protected request."}
          </div>
          <p className="mt-5 text-center text-sm text-muted-foreground">
            New to FlowCred AI? <Link to="/register" className="font-semibold text-primary hover:underline">Create an account</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
