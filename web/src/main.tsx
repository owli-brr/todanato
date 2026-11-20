import { StrictMode, lazy, Suspense, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import './index.css';
import { AuthProvider, useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { Layout } from '@/components/Layout';
import { Spinner, EmptyState } from '@/components/ui/misc';
import { ForcedPasswordChange, ForgotPasswordPage, LoginPage, ResetPasswordPage } from '@/pages/auth';
import { ApplicationStatusPage, ApplyPage } from '@/pages/apply';
import { DriverActivatePage, DriverLoginPage, DriverPortalPage } from '@/pages/driver-portal';
import { ShieldOff } from 'lucide-react';
import { useToda } from '@/components/shared';

const Dashboard = lazy(() => import('@/pages/dashboard'));
const DriversList = lazy(() => import('@/pages/drivers/list'));
const DriverForm = lazy(() => import('@/pages/drivers/form'));
const DriverProfile = lazy(() => import('@/pages/drivers/profile'));
const VehiclesList = lazy(() => import('@/pages/vehicles/list'));
const VehicleForm = lazy(() => import('@/pages/vehicles/form'));
const VehicleProfile = lazy(() => import('@/pages/vehicles/profile'));
const FinancePage = lazy(() => import('@/pages/finance'));
const PaymentReceiptPage = lazy(() => import('@/pages/finance/receipt'));
const ReportsPage = lazy(() => import('@/pages/reports'));
const DocumentsPage = lazy(() => import('@/pages/documents'));
const AnnouncementsPage = lazy(() => import('@/pages/announcements'));
const IncidentsPage = lazy(() => import('@/pages/incidents'));
const IncidentPage = lazy(() => import('@/pages/incidents').then((m) => ({ default: m.IncidentPage })));
const AssociationForm = lazy(() => import('@/pages/associations/form'));
const AssociationProfile = lazy(() => import('@/pages/associations/profile'));
const UsersPage = lazy(() => import('@/pages/users'));
const AuditPage = lazy(() => import('@/pages/audit'));
const SettingsPage = lazy(() => import('@/pages/settings'));

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
    },
  },
});

const Loading = () => <div className="flex min-h-[50vh] items-center justify-center"><Spinner className="size-7" /></div>;

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="flex min-h-screen items-center justify-center"><Spinner className="size-8" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  if (user.mustChangePassword) return <ForcedPasswordChange />;
  return <>{children}</>;
}

function Guard({ perm, children }: { perm?: string; children: ReactNode }) {
  const { can } = useAuth();
  if (perm && !can(perm)) return <EmptyState icon={ShieldOff} title="You don't have access to this page" description="Ask your organization administrator if you need this." />;
  return <Suspense fallback={<Loading />}>{children}</Suspense>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? <Navigate to="/" replace /> : <>{children}</>;
}

/** The single TODA's profile (and its edit form). */
function TodaPage({ edit }: { edit?: boolean }) {
  const { data, error } = useToda();
  if (error) return <EmptyState title="Couldn't load the TODA profile" description={error instanceof Error ? error.message : undefined} />;
  if (!data) return <div className="flex justify-center py-20"><Spinner /></div>;
  return edit ? <AssociationForm id={data.id} /> : <AssociationProfile id={data.id} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
            <Route path="/apply" element={<ApplyPage />} />
            <Route path="/application-status" element={<ApplicationStatusPage />} />
            <Route path="/driver" element={<DriverPortalPage />} />
            <Route path="/driver/login" element={<DriverLoginPage />} />
            <Route path="/driver/activate" element={<DriverActivatePage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route element={<RequireAuth><Layout /></RequireAuth>}>
              <Route index element={<Guard perm="dashboard.view"><Dashboard /></Guard>} />
              <Route path="drivers" element={<Guard perm="drivers.read"><DriversList /></Guard>} />
              <Route path="drivers/new" element={<Guard perm="drivers.create"><DriverForm /></Guard>} />
              <Route path="drivers/:id" element={<Guard perm="drivers.read"><DriverProfile /></Guard>} />
              <Route path="drivers/:id/edit" element={<Guard perm="drivers.update"><DriverForm /></Guard>} />
              <Route path="vehicles" element={<Guard perm="vehicles.read"><VehiclesList /></Guard>} />
              <Route path="finance" element={<Guard perm="finance.read"><FinancePage /></Guard>} />
              <Route path="finance/payments/:id" element={<Guard perm="finance.read"><PaymentReceiptPage /></Guard>} />
              <Route path="reports" element={<Guard perm="reports.view"><ReportsPage /></Guard>} />
              <Route path="documents" element={<Guard perm="drivers.read"><DocumentsPage /></Guard>} />
              <Route path="announcements" element={<Guard perm="announcements.manage"><AnnouncementsPage /></Guard>} />
              <Route path="incidents" element={<Guard perm="incidents.read"><IncidentsPage /></Guard>} />
              <Route path="incidents/:id" element={<Guard perm="incidents.read"><IncidentPage /></Guard>} />
              <Route path="vehicles/new" element={<Guard perm="vehicles.create"><VehicleForm /></Guard>} />
              <Route path="vehicles/:id" element={<Guard perm="vehicles.read"><VehicleProfile /></Guard>} />
              <Route path="vehicles/:id/edit" element={<Guard perm="vehicles.update"><VehicleForm /></Guard>} />
              <Route path="toda" element={<Guard perm="associations.read"><TodaPage /></Guard>} />
              <Route path="toda/edit" element={<Guard perm="associations.update"><TodaPage edit /></Guard>} />
              <Route path="associations/*" element={<Navigate to="/toda" replace />} />
              <Route path="users" element={<Guard perm="users.read"><UsersPage /></Guard>} />
              <Route path="audit" element={<Guard perm="audit.read"><AuditPage /></Guard>} />
              <Route path="settings" element={<Guard><SettingsPage /></Guard>} />
              <Route path="*" element={<EmptyState title="Page not found" description="The page you're looking for doesn't exist." />} />
            </Route>
          </Routes>
          <Toaster richColors position="top-right" closeButton />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
