import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { AppLayout } from "@/components/layout/app-layout";
import { ProtectedRoute } from "@/components/layout/protected-route";
import { PageSkeleton } from "@/components/common/loading";

const LoginPage = lazy(() => import("@/pages/login"));
const LandingPage = lazy(() => import("@/pages/landing"));
const RegisterPage = lazy(() => import("@/pages/register"));
const DashboardPage = lazy(() => import("@/pages/dashboard"));
const InvoicesPage = lazy(() => import("@/pages/invoices"));
const InvoiceDetailPage = lazy(() => import("@/pages/invoice-detail"));
const PaymentRiskPage = lazy(() => import("@/pages/payment-risk"));
const DelayPredictionsPage = lazy(() => import("@/pages/delay-predictions"));
const CustomersPage = lazy(() => import("@/pages/customers"));
const CustomerDetailPage = lazy(() => import("@/pages/customer-detail"));
const CustomerSegmentsPage = lazy(() => import("@/pages/customer-segments"));
const InsightsPage = lazy(() => import("@/pages/insights"));
const ModelPerformancePage = lazy(() => import("@/pages/model-performance"));
const DataManagementPage = lazy(() => import("@/pages/data-management"));
const ReportsPage = lazy(() => import("@/pages/reports"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const CashFlowForecastPage = lazy(() => import("@/pages/cash-flow-forecast"));
const NotFoundPage = lazy(() => import("@/pages/not-found"));

export default function App() {
  return (
    <>
      <Suspense fallback={<PageSkeleton />}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/invoices" element={<InvoicesPage />} />
              <Route path="/invoices/:invoiceId" element={<InvoiceDetailPage />} />
              <Route path="/payment-risk" element={<PaymentRiskPage />} />
              <Route path="/delay-predictions" element={<DelayPredictionsPage />} />
              <Route path="/customers" element={<CustomersPage />} />
              <Route path="/customers/:customerId" element={<CustomerDetailPage />} />
              <Route path="/customer-segments" element={<CustomerSegmentsPage />} />
              <Route path="/insights" element={<InsightsPage />} />
              <Route path="/model-performance" element={<ModelPerformancePage />} />
              <Route path="/data-management" element={<DataManagementPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/cash-flow-forecast" element={<CashFlowForecastPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
        </Routes>
      </Suspense>
      <Toaster
        position="top-right"
        richColors
        closeButton
        toastOptions={{ style: { fontSize: "13px" } }}
      />
    </>
  );
}
