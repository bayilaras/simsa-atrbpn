import { FileCapabilityGuard } from '@/components/FileCapabilityGuard'
import { AppServiceNotice } from '@/components/AppServiceNotice'
import { lazy, Suspense, useEffect, useLayoutEffect } from 'react'
import { createBrowserRouter, RouterProvider, Navigate, Outlet, Link, useLocation, useRouteError } from 'react-router-dom'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { AppHeader } from '@/components/app-header'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { Toaster } from '@/components/ui/toaster'
import { OfflineIndicator } from '@/components/OfflineIndicator'
import ErrorBoundary, { HalamanGalat } from '@/components/ErrorBoundary'
import { IdleWarningBanner } from '@/components/IdleWarningBanner'
import { ProvisionedAccessGate } from '@/components/ProvisionedAccessGate'
import { useAuth } from './context/AuthContext'
import Login from '@/pages/Login' // Eager: first page users see
import PrintLayout from '@/layouts/PrintLayout'
import appConfig from '@/lib/app-config'
import { PROVISIONED_ROLES, hasProvisionedAccess } from '@/lib/provisioning-access'
import { useAppConfig } from '@/context/app-config-context'
import { muatHalaman } from '@/lib/muat-halaman'
import { ingatHalamanKembali } from '@/lib/sesi-masuk'
import './index.css'

// Lazy-loaded pages — each becomes a separate chunk for faster initial load.
// muatHalaman: a chunk that cannot be downloaded (e.g. replaced by a new
// release) reloads the page once, then shows the error screen with a reload
// action (lib/muat-halaman.js).
const halaman = (impor) => lazy(muatHalaman(impor))

const Dashboard = halaman(() => import('@/pages/Dashboard'))
const SuratMasuk = halaman(() => import('@/pages/SuratMasuk'))
const SuratKeluar = halaman(() => import('@/pages/SuratKeluar'))
const LacakSurat = halaman(() => import('@/pages/LacakSurat'))
const TambahSuratMasuk = halaman(() => import('@/pages/TambahSuratMasuk'))
const TambahSuratKeluar = halaman(() => import('@/pages/TambahSuratKeluar'))
const Arsip = halaman(() => import('@/pages/Arsip'))
const ArsipDetail = halaman(() => import('@/pages/ArsipDetail'))
const UserManagement = halaman(() => import('@/pages/UserManagement'))
const AuditLog = halaman(() => import('@/pages/AuditLog'))
const OperationsMonitoring = halaman(() => import('@/pages/OperationsMonitoring'))
const KlasifikasiArsip = halaman(() => import('@/pages/KlasifikasiArsip'))
const JadwalRetensi = halaman(() => import('@/pages/JadwalRetensi'))
const RegulatoryRuleSets = halaman(() => import('@/pages/RegulatoryRuleSets'))
const StorageLocations = halaman(() => import('@/pages/StorageLocations'))
const StorageLocationDetail = halaman(() => import('@/pages/StorageLocationDetail'))
const ArchiveLending = halaman(() => import('@/pages/ArchiveLending'))
const Dosir = halaman(() => import('@/pages/Dosir'))
const DosirDetail = halaman(() => import('@/pages/DosirDetail'))
const RetentionManagement = halaman(() => import('@/pages/RetentionManagement'))
const RetentionGovernance = halaman(() => import('@/pages/RetentionGovernance'))
const BulkUpload = halaman(() => import('@/pages/BulkUpload'))
const DistributionInbox = halaman(() => import('@/pages/DistributionInbox'))
const SuratMasukDetail = halaman(() => import('@/pages/SuratMasukDetail'))
const SuratKeluarDetail = halaman(() => import('@/pages/SuratKeluarDetail'))
const Laporan = halaman(() => import('@/pages/Laporan'))
const Settings = halaman(() => import('@/pages/Settings'))
const PenyusutanArsip = halaman(() => import('@/pages/PenyusutanArsip'))
const ArsipVital = halaman(() => import('@/pages/ArsipVital'))
const ArsipTerjaga = halaman(() => import('@/pages/ArsipTerjaga'))
const ArsipElektronik = halaman(() => import('@/pages/ArsipElektronik'))
const TunjukSilang = halaman(() => import('@/pages/TunjukSilang'))
const AutentikasiIndex = halaman(() => import('@/pages/Autentikasi/Index'))
const AutentikasiCreate = halaman(() => import('@/pages/Autentikasi/Create'))
const FormulirIndex = halaman(() => import('@/pages/Formulir/Index'))
const FormulirViewer = halaman(() => import('@/pages/Formulir/FormulirViewer'))
const LembarDisposisi = halaman(() => import('@/pages/LembarDisposisi'))
const LayananArsipIndex = halaman(() => import('@/pages/LayananArsip/Index'))
const LayananArsipCreate = halaman(() => import('@/pages/LayananArsip/Create'))
const LayananArsipDetail = halaman(() => import('@/pages/LayananArsip/Detail'))
const RecordAccessGrants = halaman(() => import('@/pages/RecordAccessGrants'))
const UserGuide = halaman(() => import('@/pages/UserGuide'))
const NotFound = halaman(() => import('@/pages/NotFound'))
const SrikandiIntegration = appConfig.features.srikandi
  ? halaman(() => import('@/pages/SrikandiIntegration'))
  : null

// Suspense loading fallback
function PageLoader() {
  return (
    <div role="status" aria-live="polite" className="flex min-h-[40vh] items-center justify-center p-6">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <img src="/logo-simsa.png" alt="" className="h-9 w-9" />
        <span>Memuat halaman…</span>
      </div>
    </div>
  )
}

// Layar galat berbahasa Indonesia untuk satu halaman. Layar itu ditutup saat
// pengguna berpindah halaman (location.key berganti), sehingga menu lain tetap
// dapat dibuka setelah satu halaman gagal.
function BatasGalatHalaman({ children, ...props }) {
  const location = useLocation()
  return <ErrorBoundary resetKey={location.key} {...props}>{children}</ErrorBoundary>
}

// Cadangan terakhir untuk galat di luar BatasGalatHalaman (mis. kerangka
// aplikasi), pengganti layar galat bawaan router yang berbahasa Inggris.
function GalatRute({ tanpaDashboard = false }) {
  const error = useRouteError()
  useEffect(() => {
    console.error('Error caught by route:', error)
  }, [error])
  return (
    <main className="flex min-h-svh items-center justify-center bg-background">
      <HalamanGalat error={error} tanpaDashboard={tanpaDashboard} />
    </main>
  )
}

// Sesi berakhir saat halaman ini terbuka: ingat halamannya (sessionStorage tab
// ini, bukan alamat halaman masuk) agar pengguna yang sama kembali ke sini
// setelah masuk lagi. Keluar dengan sengaja tidak meninggalkan apa pun untuk diingat.
function AlihkanKeHalamanMasuk() {
  const location = useLocation()
  const alamat = location.pathname + location.search
  useLayoutEffect(() => {
    ingatHalamanKembali(alamat)
  }, [alamat])
  return <Navigate to="/login" replace />
}

// Halaman yang diingat saat sesi berakhir hanya berlaku untuk pendaratan
// pertama setelah masuk. Masuk dengan Google mendarat di Dashboard, jadi dari
// sana pengguna dibawa ke halaman itu; begitu halaman lain terbuka, ingatan itu
// dikosongkan agar Dashboard dapat dibuka seperti biasa.
function useHalamanKembali() {
  const { isAuthenticated, halamanKembali, hapusHalamanKembali } = useAuth()
  const { pathname } = useLocation()
  const diDashboard = pathname === '/'
  const usang = isAuthenticated && Boolean(halamanKembali) && !diDashboard

  useEffect(() => {
    if (usang) hapusHalamanKembali?.()
  }, [usang, hapusHalamanKembali])

  return isAuthenticated && diDashboard && halamanKembali ? halamanKembali : null
}

// Protected route wrapper
function ProtectedRoute({ children }) {
  const { isAuthenticated, loading, user, checkAuth, signOut } = useAuth();
  const halamanKembali = useHalamanKembali()

  if (loading) {
    return <PageLoader />;
  }

  if (!isAuthenticated) {
    return <AlihkanKeHalamanMasuk />;
  }

  if (halamanKembali) {
    return <Navigate to={halamanKembali} replace />;
  }

  return (
    <ProvisionedAccessGate user={user} onRefresh={checkAuth} onSignOut={signOut}>
      {children ? children : <Outlet />}
    </ProvisionedAccessGate>
  );
}

// Role-based route guard — redirects to dashboard if user lacks required role
function RoleGuard({ allowedRoles, children }) {
  const { user } = useAuth();

  if (!user || !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return children;
}

function RouteFocusManager() {
  const { pathname } = useLocation()

  useEffect(() => {
    document.getElementById('main-content')?.focus({ preventScroll: true })
  }, [pathname])

  return null
}

function SrikandiFeatureGuard({ children }) {
  const { features, loading } = useAppConfig()

  if (loading) return <PageLoader />
  if (!features.srikandi) return <Navigate to="/not-found" replace />

  return children
}

function OptionalModuleGuard({ capability, children }) {
  const { capabilities, loading } = useAppConfig()
  if (loading) return <PageLoader />
  if (capabilities[capability] === false) return (
    <section className="space-y-4 p-6" aria-label="Ketersediaan modul">
      <h1 className="text-xl font-semibold">Modul belum diaktifkan</h1>
      <p className="text-muted-foreground">Modul ini belum diaktifkan pada layanan ini. Surat dan arsip manual tetap tersedia.</p>
      <Link className="inline-flex min-h-11 items-center text-sm text-primary underline" to="/arsip/masuk">Buka daftar arsip</Link>
    </section>
  )
  return children
}



const ADMIN_ROLES = ['super_admin', 'admin_unit', 'admin_dirjen', 'admin_sesditjen'];
const SUPER_ADMIN_ONLY = ['super_admin'];
const ADMIN_AND_AUDITOR = ['super_admin', 'admin_unit', 'admin_dirjen', 'admin_sesditjen', 'auditor'];
const ALL_ADMIN_ROLES = ['super_admin', 'admin_unit', 'admin_dirjen', 'admin_sesditjen'];
const STAFF_AND_ABOVE = ALL_ADMIN_ROLES;
const ALL_PROVISIONED_ROLES = PROVISIONED_ROLES;

function AppLayout() {
  return (
    <SidebarProvider>
      <a className="skip-link" href="#main-content">Lewati ke konten utama</a>
      <RouteFocusManager />
      <AppSidebar />
      {/* min-w-0: SidebarInset is w-full, which at the tablet breakpoint would sit
          beside the 16rem rail and push the page wider than the viewport. */}
      <SidebarInset className="min-w-0">
        <AppHeader />
        {/* min-w-0 lets wide children (tables, charts) scroll inside their own
            container instead of stretching the shell on small screens. */}
        <main id="main-content" tabIndex={-1} className="flex-1 min-w-0 px-4 py-5 outline-none sm:px-6 sm:py-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1600px] space-y-5 sm:space-y-6">
            <Breadcrumbs />
            <AppServiceNotice />
            <BatasGalatHalaman fallbackMessage="Terjadi kesalahan saat memuat halaman. Silakan coba lagi.">
              <Suspense fallback={<PageLoader />}>
                <Outlet />
              </Suspense>
            </BatasGalatHalaman>
          </div>
        </main>
        <Toaster />
        <OfflineIndicator />
        <IdleWarningBanner />
      </SidebarInset>
    </SidebarProvider>
  )
}

function GuideLayout() {
  const { isAuthenticated, loading, user } = useAuth()
  useHalamanKembali()

  if (!loading && isAuthenticated && hasProvisionedAccess(user)) {
    return <AppLayout />
  }

  return (
    <div className="min-h-svh bg-background">
      <a className="skip-link" href="#main-content">Lewati ke konten utama</a>
      <RouteFocusManager />
      <header className="border-b bg-card print:hidden">
        <div className="mx-auto flex min-h-16 w-full max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link to="/login" className="flex min-h-11 min-w-0 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <img src="/logo-simsa.png" alt="" className="h-9 w-9 rounded-md bg-card p-1 ring-1 ring-border" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{appConfig.shortName}</p>
              <p className="truncate text-xs text-muted-foreground">Ditjen PTPP</p>
            </div>
          </Link>
          <Link
            to={isAuthenticated ? '/' : '/login'}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {isAuthenticated ? <span>Kembali ke status akses</span> : <>
              <span className="sm:hidden">Login</span>
              <span className="hidden sm:inline">Kembali ke login</span>
            </>}
          </Link>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1600px] px-4 py-5 outline-none sm:px-6 sm:py-6 lg:px-8">
        <div className="mb-5"><AppServiceNotice /></div>
        <BatasGalatHalaman tanpaDashboard={!isAuthenticated}>
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </BatasGalatHalaman>
      </main>
    </div>
  )
}

const router = createBrowserRouter([
  {
    path: "/login",
    element: <BatasGalatHalaman tanpaDashboard><Login /></BatasGalatHalaman>,
    errorElement: <GalatRute tanpaDashboard />,
  },
  {
    path: "/panduan",
    element: <GuideLayout />,
    errorElement: <GalatRute />,
    children: [
      { index: true, element: <UserGuide /> },
    ],
  },
  {
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    errorElement: <GalatRute />,
    children: [
      { path: "/", element: <Dashboard /> },
      { path: "/surat/masuk", element: <RoleGuard allowedRoles={ALL_PROVISIONED_ROLES}><SuratMasuk /></RoleGuard> },
      { path: "/surat/masuk/tambah", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><TambahSuratMasuk /></RoleGuard> },
      { path: "/surat/masuk/:id", element: <SuratMasukDetail /> },
      { path: "/surat/masuk/edit/:id", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><TambahSuratMasuk /></RoleGuard> },
      { path: "/surat/keluar", element: <RoleGuard allowedRoles={ALL_PROVISIONED_ROLES}><SuratKeluar /></RoleGuard> },
      { path: "/surat/keluar/tambah", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><TambahSuratKeluar /></RoleGuard> },
      { path: "/surat/keluar/inisiatif", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><TambahSuratKeluar mode="inisiatif" /></RoleGuard> },
      { path: "/surat/keluar/:id", element: <SuratKeluarDetail /> },
      { path: "/surat/keluar/edit/:id", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><TambahSuratKeluar /></RoleGuard> },
      { path: "/surat/lacak", element: <RoleGuard allowedRoles={ALL_PROVISIONED_ROLES}><LacakSurat /></RoleGuard> },
      { path: "/distribusi", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><DistributionInbox /></RoleGuard> },
      { path: "/arsip", element: <Navigate to="/arsip/keluar" replace /> },
      { path: "/arsip/detail/:id", element: <RoleGuard allowedRoles={ALL_PROVISIONED_ROLES}><ArsipDetail /></RoleGuard> },
      { path: "/arsip/:tab", element: <RoleGuard allowedRoles={ALL_PROVISIONED_ROLES}><Arsip /></RoleGuard> },
      { path: "/bulk-upload", element: <OptionalModuleGuard capability="bulkOcr"><FileCapabilityGuard upload><RoleGuard allowedRoles={ALL_ADMIN_ROLES}><BulkUpload /></RoleGuard></FileCapabilityGuard></OptionalModuleGuard> },
      { path: "/laporan", element: <RoleGuard allowedRoles={ALL_PROVISIONED_ROLES}><Laporan /></RoleGuard> },
      { path: "/audit-log", element: <RoleGuard allowedRoles={SUPER_ADMIN_ONLY}><AuditLog /></RoleGuard> },
      { path: "/monitoring-operasional", element: <RoleGuard allowedRoles={SUPER_ADMIN_ONLY}><OperationsMonitoring /></RoleGuard> },
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
      { path: "/settings", element: <RoleGuard allowedRoles={ALL_PROVISIONED_ROLES}><Settings /></RoleGuard> },
      { path: "/users", element: <RoleGuard allowedRoles={SUPER_ADMIN_ONLY}><UserManagement /></RoleGuard> },
      { path: "/master/klasifikasi", element: <RoleGuard allowedRoles={SUPER_ADMIN_ONLY}><KlasifikasiArsip /></RoleGuard> },
      { path: "/master/jra", element: <RoleGuard allowedRoles={SUPER_ADMIN_ONLY}><JadwalRetensi /></RoleGuard> },
      { path: "/master/regulatory-rules", element: <RoleGuard allowedRoles={SUPER_ADMIN_ONLY}><RegulatoryRuleSets /></RoleGuard> },
      { path: "/storage-locations", element: <RoleGuard allowedRoles={ADMIN_ROLES}><StorageLocations /></RoleGuard> },
      { path: "/storage-locations/:id", element: <RoleGuard allowedRoles={ADMIN_ROLES}><StorageLocationDetail /></RoleGuard> },
      { path: "/archive-lending", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><ArchiveLending /></RoleGuard> },
      { path: "/dosir", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><Dosir /></RoleGuard> },
      { path: "/dosir/:id", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><DosirDetail /></RoleGuard> },
      { path: "/retention", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><RetentionManagement /></RoleGuard> },
      { path: "/retention-governance", element: <RoleGuard allowedRoles={ADMIN_AND_AUDITOR}><RetentionGovernance /></RoleGuard> },
      { path: "/penyusutan", element: <OptionalModuleGuard capability="advancedArchiveWorkflows"><RoleGuard allowedRoles={ALL_ADMIN_ROLES}><PenyusutanArsip /></RoleGuard></OptionalModuleGuard> },
      { path: "/arsip-vital", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><ArsipVital /></RoleGuard> },
      { path: "/arsip-terjaga", element: <OptionalModuleGuard capability="advancedArchiveWorkflows"><RoleGuard allowedRoles={ALL_ADMIN_ROLES}><ArsipTerjaga /></RoleGuard></OptionalModuleGuard> },
      { path: "/arsip-elektronik", element: <FileCapabilityGuard><RoleGuard allowedRoles={ALL_ADMIN_ROLES}><ArsipElektronik /></RoleGuard></FileCapabilityGuard> },
      { path: "/tunjuk-silang", element: <RoleGuard allowedRoles={ALL_ADMIN_ROLES}><TunjukSilang /></RoleGuard> },
      { path: "/autentikasi", element: <FileCapabilityGuard><RoleGuard allowedRoles={SUPER_ADMIN_ONLY}><AutentikasiIndex /></RoleGuard></FileCapabilityGuard> },
      { path: "/autentikasi/create", element: <FileCapabilityGuard><RoleGuard allowedRoles={SUPER_ADMIN_ONLY}><AutentikasiCreate /></RoleGuard></FileCapabilityGuard> },
      { path: "/formulir", element: <FormulirIndex /> },
      { path: "/layanan-arsip", element: <RoleGuard allowedRoles={ALL_PROVISIONED_ROLES}><LayananArsipIndex /></RoleGuard> },
      { path: "/layanan-arsip/create", element: <RoleGuard allowedRoles={STAFF_AND_ABOVE}><LayananArsipCreate /></RoleGuard> },
      { path: "/layanan-arsip/:id", element: <RoleGuard allowedRoles={ALL_PROVISIONED_ROLES}><LayananArsipDetail /></RoleGuard> },
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
    errorElement: <GalatRute />,
    children: [
      {
        path: "/formulir/cetak/:id",
        element: (
          <BatasGalatHalaman>
            <Suspense fallback={<PageLoader />}>
              <FormulirViewer />
            </Suspense>
          </BatasGalatHalaman>
        ),
      },
      {
        path: "/surat/masuk/:id/lembar-disposisi",
        element: (
          <RoleGuard allowedRoles={ALL_PROVISIONED_ROLES}>
            <BatasGalatHalaman>
              <Suspense fallback={<PageLoader />}>
                <LembarDisposisi />
              </Suspense>
            </BatasGalatHalaman>
          </RoleGuard>
        ),
      },
    ],
  },
]);

function App() {
  return <RouterProvider router={router} />
}

export default App
