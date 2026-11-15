import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/brand-mark";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { API_MODE, APP_NAME, ROLE_LABELS } from "@/lib/constants";
import { http } from "@/api/client";
import { useAuthStore } from "@/stores/auth";
import type { Role, SessionUser } from "@/types";

const schema = z.object({
  name: z.string().trim().min(2, "Enter your full name.").max(160, "Name must be 160 characters or fewer."),
  email: z.string().trim().email("Enter a valid work email.").max(320, "Email address is too long."),
  password: z.string().min(8, "Use at least 8 characters.").max(256, "Password must be 256 characters or fewer.")
    .regex(/[a-z]/, "Add a lowercase letter.").regex(/[A-Z]/, "Add an uppercase letter.").regex(/[0-9]/, "Add a number."),
  confirmPassword: z.string(),
  acceptedTerms: z.boolean().refine((value) => value, "Please acknowledge the terms and privacy notice."),
}).refine((values) => values.password === values.confirmPassword, {
  path: ["confirmPassword"], message: "Passwords do not match.",
});

type FormValues = z.infer<typeof schema>;

export default function RegisterPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const setSession = useAuthStore((state) => state.setSession);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { name: "", email: "", password: "", confirmPassword: "", acceptedTerms: false } });

  if (user) return <Navigate to="/dashboard" replace />;

  const onSubmit = async ({ name, email, password }: FormValues) => {
    if (API_MODE !== "live") {
      toast.error("Account registration requires live authentication. Start the API in live mode to create an account.");
      return;
    }
    try {
      const { data } = await http.post("/auth/register", { name, email, password });
      const registeredUser = data.user as SessionUser;
      setSession(registeredUser, data.accessToken, data.refreshToken);
      const role = ROLE_LABELS[registeredUser.role as Role] ?? registeredUser.role;
      toast.success("Your account is ready", { description: `You’re signed in as ${role}.` });
      navigate("/dashboard", { replace: true });
    } catch (error: any) {
      const status = error?.status;
      const message = status === 409
        ? "An account with this email already exists. Sign in instead."
        : status === 422
          ? (typeof error?.message === "string" ? error.message : "Check your details and password requirements.")
          : error?.message ?? "We couldn’t reach FlowCred AI. Check your connection and try again.";
      toast.error(message);
    }
  };

  return <main className="grid min-h-screen bg-background lg:grid-cols-[1.05fr_0.95fr]">
    <section className="relative hidden flex-col justify-between overflow-hidden bg-brand-navy p-10 text-white lg:flex xl:p-14">
      <div className="absolute -right-32 top-1/4 h-96 w-96 rounded-full border border-white/10" />
      <div className="absolute -right-16 top-[30%] h-64 w-64 rounded-full border border-emerald-300/15" />
      <Link to="/" className="relative flex w-fit items-center gap-3" aria-label={`${APP_NAME} home`}>
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15"><BrandMark /></span>
        <span><b className="block text-lg">{APP_NAME}</b><small className="text-[10px] uppercase tracking-[0.16em] text-white/50">Receivables Intelligence</small></span>
      </Link>
      <div className="relative max-w-xl py-16">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Receivables intelligence</p>
        <h1 className="mt-5 text-balance text-4xl font-semibold leading-tight xl:text-5xl">A clearer view of every payment decision.</h1>
        <p className="mt-5 max-w-lg leading-7 text-white/65">Bring payment risk, expected delay and customer behaviour into one explainable workspace.</p>
        <div className="mt-10 flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.06] p-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
          <p className="text-sm leading-6 text-white/70">Your account permissions come from the platform. Public sign-ups start with accountant access.</p>
        </div>
      </div>
      <p className="relative text-xs text-white/35">{APP_NAME} · Receivables Intelligence</p>
    </section>
    <section className="flex items-center justify-center px-5 py-10 sm:px-10 lg:px-14">
      <div className="w-full max-w-[430px]">
        <Link to="/" className="mb-9 inline-flex items-center gap-2 text-sm font-semibold text-primary lg:hidden"><BrandMark /> {APP_NAME}</Link>
        <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-brand-accent">Get started</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight">Create your account</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Set up your workspace and bring your receivables into focus.</p>
        <form className="mt-7 space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <Field label="Full name" id="name" error={form.formState.errors.name?.message}><Input id="name" autoComplete="name" placeholder="Your full name" {...form.register("name")} /></Field>
          <Field label="Work email" id="email" error={form.formState.errors.email?.message}><Input id="email" type="email" autoComplete="email" placeholder="you@company.com" {...form.register("email")} /></Field>
          <Field label="Password" id="password" error={form.formState.errors.password?.message}>
            <div className="relative"><Input id="password" type={showPassword ? "text" : "password"} autoComplete="new-password" className="pr-11" {...form.register("password")} /><VisibilityButton visible={showPassword} toggle={() => setShowPassword((v) => !v)} /></div>
            <span className="text-[11px] text-muted-foreground">At least 8 characters, with uppercase, lowercase and a number.</span>
          </Field>
          <Field label="Confirm password" id="confirmPassword" error={form.formState.errors.confirmPassword?.message}>
            <div className="relative"><Input id="confirmPassword" type={showConfirmPassword ? "text" : "password"} autoComplete="new-password" className="pr-11" {...form.register("confirmPassword")} /><VisibilityButton visible={showConfirmPassword} toggle={() => setShowConfirmPassword((v) => !v)} /></div>
          </Field>
          <div className="space-y-1">
            <label className="flex items-start gap-2.5 text-xs leading-5 text-muted-foreground"><input type="checkbox" className="mt-1 h-4 w-4 rounded border-input accent-primary" {...form.register("acceptedTerms")} /><span>I acknowledge the Terms of Service and Privacy Policy.</span></label>
            {form.formState.errors.acceptedTerms ? <p className="text-xs text-risk-high">{form.formState.errors.acceptedTerms.message}</p> : null}
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? "Creating account…" : "Create account"}<ArrowRight className="h-4 w-4" /></Button>
        </form>
        {API_MODE !== "live" ? <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">Account creation is available when the frontend is connected to the live authentication API.</p> : null}
        <p className="mt-6 text-center text-sm text-muted-foreground">Already have an account? <Link to="/login" className="font-semibold text-primary hover:underline">Sign in</Link></p>
      </div>
    </section>
  </main>;
}

function Field({ label, id, error, children }: { label: string; id: string; error?: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label>{children}{error ? <p className="text-xs text-risk-high">{error}</p> : null}</div>;
}

function VisibilityButton({ visible, toggle }: { visible: boolean; toggle: () => void }) {
  return <button type="button" onClick={toggle} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label={visible ? "Hide password" : "Show password"}>{visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>;
}

