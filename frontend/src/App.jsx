import { lazy, Suspense } from 'react'
import { createBrowserRouter, RouterProvider, Navigate, Outlet } from 'react-router-dom'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { AppHeader } from '@/components/app-header'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { Toaster } from '@/components/ui/toaster'
import { OfflineIndicator } from '@/components/OfflineIndicator'
import ErrorBoundary from '@/components/ErrorBoundary'
import { IdleWarningBanner } from '@/components/IdleWarningBanner'
import { useAuth } from './context/AuthContext'
import Login from '@/pages/Login' // Eager: first page users see
import PrintLayout from '@/layouts/PrintLayout'
import appConfig from '@/lib/app-config'
import { useAppConfig } from '@/context/app-config-context'
import './index.css'

// Lazy-loaded pages — each becomes a separate chunk for faster initial load
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const SuratMasuk = lazy(() => import('@/pages/SuratMasuk'))
const SuratKeluar = lazy(() => import('@/pages/SuratKeluar'))
const TambahSuratMasuk = lazy(() => import('@/pages/TambahSuratMasuk'))
const TambahSuratKeluar = lazy(() => import('@/pages/TambahSuratKeluar'))
const Arsip = lazy(() => import('@/pages/Arsip'))
const ArsipDetail = lazy(() => import('@/pages/ArsipDetail'))
const UserManagement = lazy(() => import('@/pages/UserManagement'))
const AuditLog = lazy(() => import('@/pages/AuditLog'))
const KlasifikasiArsip = lazy(() => import('@/pages/KlasifikasiArsip'))
const JadwalRetensi = lazy(() => import('@/pages/JadwalRetensi'))
const RegulatoryRuleSets = lazy(() => import('@/pages/RegulatoryRuleSets'))
const StorageLocations = lazy(() => import('@/pages/StorageLocations'))
const ArchiveLending = lazy(() => import('@/pages/ArchiveLending'))
const Dosir = lazy(() => import('@/pages/Dosir'))
const DosirDetail = lazy(() => import('@/pages/DosirDetail'))
const RetentionManagement = lazy(() => import('@/pages/RetentionManagement'))
const RetentionGovernance = lazy(() => import('@/pages/RetentionGovernance'))
const BulkUpload = lazy(() => import('@/pages/BulkUpload'))
const DistributionInbox = lazy(() => import('@/pages/DistributionInbox'))
const SuratMasukDetail = lazy(() => import('@/pages/SuratMasukDetail'))
const SuratKeluarDetail = lazy(() => import('@/pages/SuratKeluarDetail'))
const Laporan = lazy(() => import('@/pages/Laporan'))
const Settings = lazy(() => import('@/pages/Settings'))
const PenyusutanArsip = lazy(() => import('@/pages/PenyusutanArsip'))
const ArsipVital = lazy(() => import('@/pages/ArsipVital'))
const ArsipTerjaga = lazy(() => import('@/pages/ArsipTerjaga'))
const ArsipElektronik = lazy(() => import('@/pages/ArsipElektronik'))
const TunjukSilang = lazy(() => import('@/pages/TunjukSilang'))
const AutentikasiIndex = lazy(() => import('@/pages/Autentikasi/Index'))
const AutentikasiCreate = lazy(() => import('@/pages/Autentikasi/Create'))
const FormulirIndex = lazy(() => import('@/pages/Formulir/Index'))
const FormulirViewer = lazy(() => import('@/pages/Formulir/FormulirViewer'))
const LayananArsipIndex = lazy(() => import('@/pages/LayananArsip/Index'))
const LayananArsipCreate = lazy(() => import('@/pages/LayananArsip/Create'))
const LayananArsipDetail = lazy(() => import('@/pages/LayananArsip/Detail'))
const RecordAccessGrants = lazy(() => import('@/pages/RecordAccessGrants'))
const NotFound = lazy(() => import('@/pages/NotFound'))
const SrikandiIntegration = appConfig.features.srikandi
  ? lazy(() => import('@/pages/SrikandiIntegration'))
  : null

// Suspense loading fallback
function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[60vh] animate-in fade-in zoom-in duration-300">
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full animate-pulse"></div>
          <img
            src="/logo-simsa.png"
            alt="Loading..."
            className="h-16 w-16 relative z-10 animate-bounce"
            style={{ animationDuration: '2s' }}
          />
        </div>
        <div className="flex flex-col items-center gap-1">
          <h3 className="font-semibold text-lg text-primary tracking-tight">{appConfig.shortName}</h3>
          <div className="flex items-center gap-1">
            <div className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-bounce [animation-delay:-0.3s]"></div>
            <div className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-bounce [animation-delay:-0.15s]"></div>
            <div className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-bounce"></div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Protected route wrapper
function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <PageLoader />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children ? children : <Outlet />;
}

// Role-based route guard — redirects to dashboard if user lacks required role
function RoleGuard({ allowedRoles, children }) {
  const { user } = useAuth();

  if (!user || !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return children;
}

function SrikandiFeatureGuard({ children }) {
  const { features, loading } = useAppConfig()

  if (loading) return <PageLoader />
  if (!features.srikandi) return <Navigate to="/not-found" replace />

  return children
}

const ADMIN_ROLES = ['super_admin', 'admin_dirjen', 'admin_sesditjen'];
const SUPER_ADMIN_ONLY = ['super_admin'];
const ADMIN_AND_AUDITOR = ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'auditor'];
const ALL_ADMIN_ROLES = ['super_admin', 'admin_dirjen', 'admin_sesditjen'];
const STAFF_AND_ABOVE = ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'staff'];
const ALL_PROVISIONED_ROLES = ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'staff', 'auditor'];

function AppLayout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      {/* min-w-0: SidebarInset is w-full, which at the tablet breakpoint would sit
          beside the 16rem rail and push the page wider than the viewport. */}
      <SidebarInset className="min-w-0">
        <AppHeader />
        {/* min-w-0 lets wide children (tables, charts) scroll inside their own
            container instead of stretching the shell on small screens. */}
        <main className="flex-1 min-w-0 px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1600px] space-y-5 sm:space-y-6">
            <Breadcrumbs />
            <ErrorBoundary fallbackMessage="Terjadi kesalahan saat memuat halaman. Silakan coba lagi.">
              <Suspense fallback={<PageLoader />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>
        <Toaster />
        <OfflineIndicator />
        <IdleWarningBanner />
      </SidebarInset>
    </SidebarProvider>
  )
}

const router = createBrowserRouter([
  {
    path: "/login",
    element: <Login />,
  },
  {
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { path: "/", element: <Dashboard /> },
      { path: "/surat/masuk", element: <RoleGuard allowedRoles={STAFF_AND_ABOVE}><SuratMasuk /></RoleGuard> },
      { path: "/surat/masuk/tambah", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><TambahSuratMasuk /></RoleGuard> },
      { path: "/surat/masuk/:id", element: <SuratMasukDetail /> },
      { path: "/surat/masuk/edit/:id", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><TambahSuratMasuk /></RoleGuard> },
      { path: "/surat/keluar", element: <RoleGuard allowedRoles={STAFF_AND_ABOVE}><SuratKeluar /></RoleGuard> },
      { path: "/surat/keluar/tambah", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><TambahSuratKeluar /></RoleGuard> },
      { path: "/surat/keluar/:id", element: <SuratKeluarDetail /> },
      { path: "/surat/keluar/edit/:id", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><TambahSuratKeluar /></RoleGuard> },
      { path: "/distribusi", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><DistributionInbox /></RoleGuard> },
      { path: "/arsip", element: <Navigate to="/arsip/keluar" replace /> },
      { path: "/arsip/detail/:id", element: <RoleGuard allowedRoles={ALL_PROVISIONED_ROLES}><ArsipDetail /></RoleGuard> },
      { path: "/arsip/:tab", element: <RoleGuard allowedRoles={STAFF_AND_ABOVE}><Arsip /></RoleGuard> },
      { path: "/bulk-upload", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><BulkUpload /></RoleGuard> },
      { path: "/laporan", element: <RoleGuard allowedRoles={STAFF_AND_ABOVE}><Laporan /></RoleGuard> },
      { path: "/audit-log", element: <RoleGuard allowedRoles={ADMIN_AND_AUDITOR}><AuditLog /></RoleGuard> },
      { path: "/record-access-grants", element: <RoleGuard allowedRoles={ALL_PROVISIONED_ROLES}><RecordAccessGrants /></RoleGuard> },
      {
        path: "/integrations/srikandi",
        element: appConfig.features.srikandi && SrikandiIntegration
          ? (
            <SrikandiFeatureGuard>
              <RoleGuard allowedRoles={ADMIN_ROLES}><SrikandiIntegration /></RoleGuard>
            </SrikandiFeatureGuard>
          )
          : <Navigate to="/not-found" replace />,
      },
      { path: "/settings", element: <RoleGuard allowedRoles={SUPER_ADMIN_ONLY}><Settings /></RoleGuard> },
      { path: "/users", element: <RoleGuard allowedRoles={SUPER_ADMIN_ONLY}><UserManagement /></RoleGuard> },
      { path: "/master/klasifikasi", element: <RoleGuard allowedRoles={ADMIN_ROLES}><KlasifikasiArsip /></RoleGuard> },
      { path: "/master/jra", element: <RoleGuard allowedRoles={ADMIN_ROLES}><JadwalRetensi /></RoleGuard> },
      { path: "/master/regulatory-rules", element: <RoleGuard allowedRoles={ADMIN_AND_AUDITOR}><RegulatoryRuleSets /></RoleGuard> },
      { path: "/storage-locations", element: <RoleGuard allowedRoles={ADMIN_ROLES}><StorageLocations /></RoleGuard> },
      { path: "/archive-lending", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><ArchiveLending /></RoleGuard> },
      { path: "/dosir", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><Dosir /></RoleGuard> },
      { path: "/dosir/:id", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><DosirDetail /></RoleGuard> },
      { path: "/retention", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><RetentionManagement /></RoleGuard> },
      { path: "/retention-governance", element: <RoleGuard allowedRoles={ADMIN_AND_AUDITOR}><RetentionGovernance /></RoleGuard> },
      { path: "/penyusutan", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><PenyusutanArsip /></RoleGuard> },
      { path: "/arsip-vital", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><ArsipVital /></RoleGuard> },
      { path: "/arsip-terjaga", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><ArsipTerjaga /></RoleGuard> },
      { path: "/arsip-elektronik", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><ArsipElektronik /></RoleGuard> },
      { path: "/tunjuk-silang", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><TunjukSilang /></RoleGuard> },
      { path: "/autentikasi", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><AutentikasiIndex /></RoleGuard> },
      { path: "/autentikasi/create", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><AutentikasiCreate /></RoleGuard> },
      { path: "/formulir", element: <FormulirIndex /> },
      { path: "/layanan-arsip", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><LayananArsipIndex /></RoleGuard> },
      { path: "/layanan-arsip/create", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><LayananArsipCreate /></RoleGuard> },
      { path: "/layanan-arsip/:id", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><LayananArsipDetail /></RoleGuard> },
      { path: "/not-found", element: <NotFound /> },
      { path: "*", element: <NotFound /> },
    ],
  },
  {
    element: (
      <ProtectedRoute>
        <PrintLayout />
      </ProtectedRoute>
    ),
    children: [
      {
        path: "/formulir/cetak/:id",
        element: (
          <Suspense fallback={<PageLoader />}>
            <FormulirViewer />
          </Suspense>
        ),
      },
    ],
  },
]);

function App() {
  return <RouterProvider router={router} />
}

export default App

