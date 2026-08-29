import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
    Archive,
    BookOpen,
    CheckCircle2,
    ChevronRight,
    CircleHelp,
    Clock3,
    FileCheck2,
    FileSearch,
    FolderTree,
    KeyRound,
    Laptop,
    LockKeyhole,
    Mail,
    Menu,
    Printer,
    Rocket,
    Scale,
    Search,
    ShieldCheck,
    Smartphone,
    Users,
} from 'lucide-react'

import { PageHeader } from '@/components/PageHeader'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/context/AuthContext'

const ALL_ROLES = ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'staff', 'auditor']
const ADMIN_ROLES = ['super_admin', 'admin_dirjen', 'admin_sesditjen']
const STAFF_AND_ADMIN = [...ADMIN_ROLES, 'staff']
const ADMIN_AND_AUDITOR = [...ADMIN_ROLES, 'auditor']

const ROLE_LABELS = {
    semua: 'Semua peran',
    super_admin: 'Super Admin',
    admin_dirjen: 'Admin Dirjen',
    admin_sesditjen: 'Admin Sesditjen',
    staff: 'Staf',
    auditor: 'Auditor',
}

const CATEGORIES = [
    { value: 'semua', label: 'Semua topik' },
    { value: 'dasar', label: 'Mulai' },
    { value: 'surat', label: 'Surat' },
    { value: 'arsip', label: 'Arsip' },
    { value: 'retensi', label: 'Retensi & JRA' },
    { value: 'layanan', label: 'Layanan' },
    { value: 'pengawasan', label: 'Pengawasan' },
]

const GUIDE_SECTIONS = [
    {
        id: 'masuk-dan-navigasi',
        category: 'dasar',
        title: 'Masuk dan mengenali aplikasi',
        summary: 'Login, membaca Dashboard, memakai sidebar, breadcrumb, dan pencarian.',
        icon: Rocket,
        roles: ALL_ROLES,
        keywords: ['login', 'google', 'dashboard', 'sidebar', 'menu', 'navigasi', 'pencarian'],
        steps: [
            'Buka alamat resmi SIMSA dan masuk dengan akun yang telah didaftarkan oleh administrator.',
            'Gunakan Dashboard untuk melihat ringkasan pekerjaan sesuai unit kerja dan kewenangan Anda.',
            'Buka sidebar untuk berpindah fitur. Di layar kecil, gunakan tombol menu pada bagian atas.',
            'Gunakan breadcrumb di atas halaman untuk mengetahui posisi dan kembali ke bagian sebelumnya.',
            'Jika suatu menu tidak terlihat, periksa peran akun Anda atau hubungi administrator.',
        ],
        action: { label: 'Buka Dashboard', to: '/' },
    },
    {
        id: 'surat-masuk-keluar',
        category: 'surat',
        title: 'Mengelola surat masuk dan keluar',
        summary: 'Mencatat metadata surat, melampirkan berkas, dan menelusuri kembali surat.',
        icon: Mail,
        roles: STAFF_AND_ADMIN,
        keywords: ['surat masuk', 'surat keluar', 'distribusi', 'metadata', 'lampiran'],
        steps: [
            'Pilih Surat Masuk atau Surat Keluar dari sidebar sesuai naskah yang akan dikelola.',
            'Cari dahulu berdasarkan nomor, perihal, pengirim, atau penerima untuk mencegah pencatatan ganda.',
            'Isi metadata dari dokumen sumber secara lengkap dan periksa kembali tanggal serta nomor surat.',
            'Tambahkan lampiran hanya pada rekod yang tepat, lalu simpan dan pastikan detailnya dapat dibuka.',
            'Gunakan Distribusi bila menu tersebut tersedia dan tindak lanjut memang diperlukan.',
        ],
        action: { label: 'Buka Surat Masuk', to: '/surat/masuk' },
    },
    {
        id: 'arsip-aktif',
        category: 'arsip',
        title: 'Menemukan dan memeriksa arsip aktif',
        summary: 'Menelusuri arsip, membaca detail, klasifikasi, lokasi, dan status siklus hidup.',
        icon: Archive,
        roles: STAFF_AND_ADMIN,
        keywords: ['arsip aktif', 'detail arsip', 'klasifikasi', 'lokasi', 'status'],
        steps: [
            'Buka Arsip Aktif dan pilih tab arsip surat masuk atau surat keluar.',
            'Gunakan filter dan istilah pencarian yang spesifik, misalnya nomor atau perihal.',
            'Buka detail arsip untuk memeriksa metadata, klasifikasi, berkas, serta informasi retensinya.',
            'Laporkan data yang tidak tepat kepada pengelola berwenang; jangan membuat rekod pengganti tanpa pemeriksaan.',
        ],
        action: { label: 'Buka Arsip Aktif', to: '/arsip/keluar' },
    },
    {
        id: 'pemberkasan-dosir',
        category: 'arsip',
        title: 'Pemberkasan dan lokasi simpan',
        summary: 'Mengelompokkan arsip dalam dosir dan mencatat lokasi penyimpanan fisik.',
        icon: FolderTree,
        roles: ADMIN_ROLES,
        keywords: ['dosir', 'pemberkasan', 'berkas', 'lokasi simpan', 'fisik'],
        steps: [
            'Pastikan setiap arsip sudah memiliki klasifikasi yang tepat sebelum diberkaskan.',
            'Buat atau pilih dosir berdasarkan urusan/kegiatan yang sama, bukan hanya kemiripan judul.',
            'Tambahkan arsip yang relevan dan hindari satu arsip masuk ke dosir yang tidak berkaitan.',
            'Catat lokasi simpan fisik secara konsisten agar rekod digital dapat ditelusuri ke medianya.',
        ],
        action: { label: 'Buka Dosir', to: '/dosir' },
    },
    {
        id: 'klasifikasi-jra',
        category: 'retensi',
        title: 'Klasifikasi Arsip dan Jadwal Retensi Arsip (JRA)',
        summary: 'Memilih aturan yang berlaku dan menjaga histori ketika pedoman berubah.',
        icon: Clock3,
        roles: ADMIN_ROLES,
        keywords: ['jra', 'jadwal retensi', 'klasifikasi', 'aktif', 'inaktif', 'nasib akhir', 'versi aturan'],
        steps: [
            'Cari klasifikasi berdasarkan fungsi atau kegiatan yang menghasilkan arsip.',
            'Cocokkan uraian JRA; jangan menentukan retensi hanya dari judul dokumen.',
            'Gunakan Versi Aturan untuk menyiapkan perubahan sumber klasifikasi/JRA melalui alur pemeriksaan.',
            'Aktifkan versi baru hanya setelah sumber, periode berlaku, dan hasil pemeriksaan lengkap.',
            'Jangan mengubah histori aturan lama untuk menyesuaikan aturan baru.',
        ],
        action: { label: 'Buka Jadwal Retensi', to: '/master/jra' },
    },
    {
        id: 'tata-kelola-retensi',
        category: 'retensi',
        title: 'Tata kelola retensi dan penilaian',
        summary: 'Verifikasi pemicu, appraisal, legal hold, dan keputusan akhir yang dapat diaudit.',
        icon: Scale,
        roles: ADMIN_AND_AUDITOR,
        keywords: ['pemicu retensi', 'verifikasi', 'appraisal', 'legal hold', 'musnah', 'permanen', 'review'],
        steps: [
            'Periksa dasar peristiwa pemicu retensi dan bukti pendukung sebelum memverifikasinya.',
            'Pastikan petugas pengusul dan pemeriksa berbeda ketika alur meminta pemeriksaan independen.',
            'Catat appraisal berdasarkan konteks arsip dan JRA yang berlaku, bukan keputusan informal.',
            'Terapkan legal hold bila arsip harus ditahan; arsip tersebut tidak boleh dilanjutkan ke pemusnahan.',
            'Baca histori keputusan sebelum melanjutkan ke tahapan penyusutan berikutnya.',
        ],
        action: { label: 'Buka Tata Kelola Retensi', to: '/retention-governance' },
    },
    {
        id: 'penyusutan-penyerahan',
        category: 'retensi',
        title: 'Penyusutan dan penyerahan arsip permanen',
        summary: 'Menindaklanjuti keputusan retensi dengan bukti dan pemisahan kewenangan.',
        icon: FileCheck2,
        roles: ADMIN_ROLES,
        keywords: ['penyusutan', 'pemusnahan', 'penyerahan', 'permanen', 'manifest', 'bukti'],
        steps: [
            'Mulai hanya dari arsip yang keputusan akhirnya sudah sah dan tidak sedang terkena legal hold.',
            'Periksa daftar arsip, jumlah, status, serta bukti sebelum membuat atau mengajukan proses.',
            'Untuk arsip permanen, pilih lampiran terkontrol yang lolos pemeriksaan integritas saat menyusun manifest.',
            'Serah-terima dan penerimaan dilakukan oleh pejabat berbeda sesuai alur di aplikasi.',
            'Jika proses harus dibatalkan, gunakan alur pembatalan agar alasan dan riwayat tetap tercatat.',
        ],
        action: { label: 'Buka Penyusutan', to: '/penyusutan' },
    },
    {
        id: 'akses-dan-layanan',
        category: 'layanan',
        title: 'Permintaan akses dan layanan arsip',
        summary: 'Menggunakan arsip secara terkendali tanpa mengubah rekod sumber.',
        icon: KeyRound,
        roles: ALL_ROLES,
        keywords: ['akses', 'persetujuan akses', 'layanan', 'peminjaman', 'izin', 'rekod'],
        steps: [
            'Gunakan Persetujuan Akses Rekod ketika arsip yang dibutuhkan tidak tersedia bagi akun Anda.',
            'Jelaskan tujuan penggunaan dan pilih rekod yang tepat agar permintaan dapat dinilai.',
            'Gunakan hanya akses yang diberikan dan jangan meneruskan berkas kepada pihak lain tanpa kewenangan.',
            'Bagi pengelola yang memiliki menu layanan/peminjaman, catat penyerahan dan pengembalian pada proses terkait.',
        ],
        action: { label: 'Buka Persetujuan Akses', to: '/record-access-grants' },
    },
    {
        id: 'audit-dan-laporan',
        category: 'pengawasan',
        title: 'Laporan dan jejak audit',
        summary: 'Mengawasi kegiatan, membaca histori, dan menindaklanjuti ketidaksesuaian.',
        icon: ShieldCheck,
        roles: ALL_ROLES,
        keywords: ['laporan', 'audit log', 'histori', 'pengawasan', 'akuntabilitas'],
        steps: [
            'Gunakan laporan yang tersedia bagi peran Anda untuk memantau data dan pekerjaan unit.',
            'Audit Log global hanya dapat dibuka Super Admin sampai seluruh baris audit memiliki pembatas unit yang dapat ditegakkan.',
            'Gunakan filter waktu, pelaku, atau jenis kejadian bila tersedia untuk mempersempit penelusuran.',
            'Jangan menganggap tampilan ringkas sebagai keputusan akhir; periksa detail rekod dan buktinya.',
        ],
        actionByRole: {
            super_admin: { label: 'Buka Audit Log', to: '/audit-log' },
            auditor: { label: 'Buka Tata Kelola Retensi', to: '/retention-governance' },
            admin_dirjen: { label: 'Buka Laporan', to: '/laporan' },
            admin_sesditjen: { label: 'Buka Laporan', to: '/laporan' },
            staff: { label: 'Buka Laporan', to: '/laporan' },
        },
    },
]

const ROLE_FLOWS = [
    {
        role: 'staff',
        title: 'Staf',
        description: 'Fokus pada pencatatan, pencarian, dan pemeriksaan surat/arsip sesuai unit kerja.',
        flow: ['Cari rekod lebih dahulu', 'Catat atau periksa metadata', 'Buka detail arsip', 'Gunakan laporan/permintaan akses'],
    },
    {
        role: 'admin_dirjen',
        title: 'Admin Ditjen',
        description: 'Mengelola proses operasional arsip dan surat pada lingkup kewenangannya.',
        flow: ['Validasi metadata', 'Klasifikasikan dan berkas-kan', 'Kelola retensi', 'Dokumentasikan penyusutan/layanan'],
    },
    {
        role: 'admin_sesditjen',
        title: 'Admin Sesditjen',
        description: 'Mengelola proses operasional dengan prinsip pemeriksaan dan jejak bukti yang sama.',
        flow: ['Validasi metadata', 'Klasifikasikan dan berkas-kan', 'Kelola retensi', 'Dokumentasikan penyusutan/layanan'],
    },
    {
        role: 'super_admin',
        title: 'Super Admin',
        description: 'Menjaga akun, konfigurasi, aturan, dan pengawasan teknis aplikasi.',
        flow: ['Provisikan pengguna', 'Kelola konfigurasi/aturan', 'Pisahkan pengusul dan pemeriksa', 'Pantau audit dan anomali'],
    },
    {
        role: 'auditor',
        title: 'Auditor',
        description: 'Menelaah bukti, histori aturan, keputusan, dan aktivitas sesuai akses baca/pemeriksaan.',
        flow: ['Tentukan ruang lingkup', 'Filter data dan audit', 'Periksa bukti serta pelaku', 'Catat temuan di luar perubahan rekod sumber'],
    },
]

const GLOSSARY = [
    ['Klasifikasi Arsip', 'Kode dan struktur fungsi/kegiatan untuk mengelompokkan arsip secara konsisten.'],
    ['JRA', 'Jadwal Retensi Arsip: jangka simpan aktif dan inaktif beserta keterangan nasib akhirnya.'],
    ['Pemicu Retensi', 'Peristiwa yang menjadi awal perhitungan masa retensi dan perlu dasar yang dapat diverifikasi.'],
    ['Appraisal', 'Penilaian arsip sebelum keputusan tindak lanjut ditetapkan.'],
    ['Legal hold', 'Penahanan sementara tindakan penyusutan karena kebutuhan hukum, audit, atau pemeriksaan.'],
    ['Dosir', 'Himpunan arsip yang berkaitan dengan urusan, kegiatan, atau perkara yang sama.'],
    ['Penyusutan', 'Tindak lanjut terkendali berdasarkan JRA dan keputusan berwenang, termasuk pemindahan, pemusnahan, atau penyerahan.'],
    ['Manifest penyerahan', 'Daftar dan bukti terstruktur untuk proses penyerahan arsip permanen.'],
    ['Checksum / fixity', 'Nilai pemeriksaan untuk mendeteksi apakah isi berkas elektronik berubah.'],
    ['Tunjuk silang', 'Hubungan antarsatu arsip dengan arsip lain agar konteks dan penelusurannya terjaga.'],
]

const TROUBLESHOOTING = [
    {
        problem: 'Tidak dapat login dengan Google',
        answer: 'Pastikan memakai akun dinas yang sudah diprovisikan, buka dari alamat resmi aplikasi, lalu coba kembali. Jika tetap gagal, kirimkan alamat email dan waktu kejadian kepada administrator—jangan mengirim kata sandi.',
    },
    {
        problem: 'Menu yang dibutuhkan tidak terlihat',
        answer: 'Menu mengikuti peran dan fitur yang diaktifkan. Pastikan Anda masuk dengan akun yang benar, lalu minta administrator memeriksa peran tanpa meminta perluasan akses yang tidak diperlukan.',
    },
    {
        problem: 'Unggahan masih dikarantina atau tidak dapat dipilih',
        answer: 'Berkas baru dapat menunggu pemeriksaan keamanan dan integritas. Jangan mengunggah ulang berkali-kali; tunggu proses selesai atau hubungi administrator bila status tidak berubah.',
    },
    {
        problem: 'Data tidak muncul setelah disimpan',
        answer: 'Periksa notifikasi hasil simpan dan koneksi, lalu muat ulang halaman. Cari kembali dengan filter yang lebih luas sebelum membuat rekod baru agar tidak terjadi duplikasi.',
    },
    {
        problem: 'Sesi berakhir saat bekerja',
        answer: 'Aplikasi mengakhiri sesi yang tidak aktif untuk keamanan. Login kembali dan periksa apakah perubahan terakhir sudah tersimpan sebelum mengulang input.',
    },
]

const normalizeSearch = (value) => value.trim().toLocaleLowerCase('id-ID')

export default function UserGuide() {
    const { user } = useAuth()
    const currentRole = ALL_ROLES.includes(user?.role) ? user.role : 'semua'
    const [query, setQuery] = useState('')
    const [category, setCategory] = useState('semua')
    const [roleFilter, setRoleFilter] = useState(currentRole)

    const filteredSections = useMemo(() => {
        const normalizedQuery = normalizeSearch(query)

        return GUIDE_SECTIONS.filter((section) => {
            const matchesCategory = category === 'semua' || section.category === category
            const matchesRole = roleFilter === 'semua' || section.roles.includes(roleFilter)
            const searchableText = [
                section.title,
                section.summary,
                ...section.keywords,
                ...section.steps,
            ].join(' ').toLocaleLowerCase('id-ID')

            return matchesCategory && matchesRole && (!normalizedQuery || searchableText.includes(normalizedQuery))
        })
    }, [category, query, roleFilter])

    const visibleRoleFlows = roleFilter === 'semua'
        ? ROLE_FLOWS
        : ROLE_FLOWS.filter((item) => item.role === roleFilter)

    return (
        <article className="space-y-6 print:space-y-4" aria-labelledby="panduan-title">
            <a
                href="#isi-panduan"
                className="sr-only rounded-md bg-background px-4 py-3 font-medium focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:ring-2 focus:ring-ring"
            >
                Lewati ke isi panduan
            </a>

            <PageHeader
                icon={BookOpen}
                title={<span id="panduan-title">Panduan Pengguna SIMSA</span>}
                description="Pelajari alur kerja pengelolaan surat dan arsip secara bertahap sesuai peran Anda."
                actions={(
                    <Button
                        type="button"
                        variant="outline"
                        className="min-h-11 print:hidden"
                        onClick={() => window.print()}
                    >
                        <Printer className="mr-2 h-4 w-4" aria-hidden="true" />
                        Cetak panduan
                    </Button>
                )}
            />

            <Alert className="border-primary/30 bg-primary/5 print:border-border print:bg-transparent">
                <CircleHelp className="h-4 w-4" aria-hidden="true" />
                <AlertTitle>Panduan ini mengikuti kewenangan pengguna</AlertTitle>
                <AlertDescription>
                    {user ? (
                        <>Anda masuk sebagai <strong>{ROLE_LABELS[currentRole] || 'Pengguna'}</strong>. Menu dan tindakan di aplikasi dapat berbeda menurut peran, unit kerja, dan status proses.</>
                    ) : (
                        <>Panduan ini dapat dipelajari sebelum login dan tidak memuat data operasional. Pilih peran untuk melihat alur yang relevan.</>
                    )}
                </AlertDescription>
            </Alert>

            <Card className="overflow-hidden border-border/60 print:hidden">
                <CardHeader className="border-b bg-muted/30">
                    <CardTitle className="text-lg">Cari topik panduan</CardTitle>
                    <CardDescription>Masukkan istilah seperti “JRA”, “login”, “surat masuk”, atau “legal hold”.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 pt-5">
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(14rem,18rem)]">
                        <div className="space-y-2">
                            <label htmlFor="guide-search" className="text-sm font-medium">Kata kunci</label>
                            <div className="relative">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                                <Input
                                    id="guide-search"
                                    type="search"
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                    placeholder="Cari bantuan..."
                                    className="min-h-11 pl-10"
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="guide-role" className="text-sm font-medium">Tampilkan untuk peran</label>
                            <select
                                id="guide-role"
                                value={roleFilter}
                                onChange={(event) => setRoleFilter(event.target.value)}
                                className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                                <option value="semua">Semua peran</option>
                                {ALL_ROLES.map((role) => (
                                    <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Filter kategori panduan">
                        {CATEGORIES.map((item) => (
                            <Button
                                key={item.value}
                                type="button"
                                variant={category === item.value ? 'default' : 'outline'}
                                size="sm"
                                className="min-h-11 shrink-0"
                                aria-pressed={category === item.value}
                                onClick={() => setCategory(item.value)}
                            >
                                {item.label}
                            </Button>
                        ))}
                    </div>

                    <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
                        {filteredSections.length} topik ditemukan untuk {ROLE_LABELS[roleFilter].toLowerCase()}.
                    </p>
                </CardContent>
            </Card>

            <section aria-labelledby="mulai-cepat" className="space-y-4">
                <div>
                    <h2 id="mulai-cepat" className="text-xl font-semibold">Mulai dalam 5 langkah</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Alur dasar yang aman bagi pengguna baru.</p>
                </div>
                <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    {[
                        ['1', 'Login', 'Gunakan akun dinas yang telah diprovisikan.'],
                        ['2', 'Baca Dashboard', 'Kenali ringkasan dan pekerjaan yang relevan.'],
                        ['3', 'Cari dahulu', 'Cegah duplikasi sebelum membuat rekod.'],
                        ['4', 'Periksa metadata', 'Cocokkan data dengan dokumen sumber.'],
                        ['5', 'Simpan dan verifikasi', 'Pastikan detail serta status sudah benar.'],
                    ].map(([number, title, description]) => (
                        <li key={number} className="rounded-lg border bg-card p-4 print:break-inside-avoid">
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground" aria-hidden="true">
                                {number}
                            </span>
                            <h3 className="mt-3 font-semibold">{title}</h3>
                            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
                        </li>
                    ))}
                </ol>
            </section>

            <nav aria-label="Daftar topik panduan" className="rounded-lg border bg-muted/20 p-4 print:hidden">
                <p className="text-sm font-semibold">Lompat ke topik</p>
                <div className="mt-3 flex flex-wrap gap-2">
                    {filteredSections.map((section) => (
                        <a
                            key={section.id}
                            href={`#${section.id}`}
                            className="inline-flex min-h-11 items-center rounded-md border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            {section.title}
                        </a>
                    ))}
                </div>
            </nav>

            <section id="isi-panduan" aria-labelledby="alur-fitur" className="scroll-mt-20 space-y-4">
                <div>
                    <h2 id="alur-fitur" className="text-xl font-semibold">Alur per fitur</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Ikuti urutan langkah dan baca kembali detail sebelum mengambil tindakan.</p>
                </div>

                {filteredSections.length > 0 ? (
                    <div className="grid gap-4 xl:grid-cols-2">
                        {filteredSections.map((section) => {
                            const Icon = section.icon
                            const action = section.actionByRole?.[currentRole] || section.action

                            return (
                                <Card key={section.id} id={section.id} className="scroll-mt-20 border-border/60 print:break-inside-avoid print:shadow-none">
                                    <CardHeader>
                                        <div className="flex items-start gap-3">
                                            <span className="mt-0.5 inline-flex rounded-md bg-accent p-2 text-accent-foreground" aria-hidden="true">
                                                <Icon className="h-5 w-5" />
                                            </span>
                                            <div className="min-w-0">
                                                <CardTitle className="text-lg">{section.title}</CardTitle>
                                                <CardDescription className="mt-1">{section.summary}</CardDescription>
                                            </div>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        <ol className="space-y-3">
                                            {section.steps.map((step, index) => (
                                                <li key={step} className="flex gap-3 text-sm leading-relaxed">
                                                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                                                    <span><span className="sr-only">Langkah {index + 1}: </span>{step}</span>
                                                </li>
                                            ))}
                                        </ol>
                                        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 print:hidden">
                                            <div className="flex flex-wrap gap-1.5" aria-label="Peran yang dapat mengakses fitur">
                                                {section.roles.map((role) => (
                                                    <Badge key={role} variant="secondary">{ROLE_LABELS[role]}</Badge>
                                                ))}
                                            </div>
                                            {action && section.roles.includes(currentRole) && (
                                                <Button asChild variant="outline" className="min-h-11">
                                                    <Link to={action.to}>
                                                        {action.label}
                                                        <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
                                                    </Link>
                                                </Button>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            )
                        })}
                    </div>
                ) : (
                    <div className="rounded-lg border border-dashed p-8 text-center" role="status">
                        <FileSearch className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
                        <h3 className="mt-3 font-semibold">Topik tidak ditemukan</h3>
                        <p className="mt-1 text-sm text-muted-foreground">Coba istilah yang lebih singkat atau pilih “Semua topik”.</p>
                        <Button
                            type="button"
                            variant="outline"
                            className="mt-4 min-h-11"
                            onClick={() => {
                                setQuery('')
                                setCategory('semua')
                            }}
                        >
                            Hapus pencarian
                        </Button>
                    </div>
                )}
            </section>

            <section aria-labelledby="panduan-peran" className="space-y-4">
                <div>
                    <h2 id="panduan-peran" className="text-xl font-semibold">Ringkasan menurut peran</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Setiap tindakan tetap mengikuti unit kerja dan kewenangan akun.</p>
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {visibleRoleFlows.map((item) => (
                        <Card key={item.role} className="print:break-inside-avoid print:shadow-none">
                            <CardHeader>
                                <div className="flex items-center gap-2">
                                    <Users className="h-5 w-5 text-primary" aria-hidden="true" />
                                    <CardTitle className="text-lg">{item.title}</CardTitle>
                                </div>
                                <CardDescription>{item.description}</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <ol className="space-y-2 text-sm">
                                    {item.flow.map((step, index) => (
                                        <li key={step} className="flex gap-2">
                                            <span className="font-semibold text-primary">{index + 1}.</span>
                                            <span>{step}</span>
                                        </li>
                                    ))}
                                </ol>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </section>

            <section aria-labelledby="istilah" className="space-y-4">
                <div>
                    <h2 id="istilah" className="text-xl font-semibold">Istilah penting</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Kosakata singkat untuk membantu pengguna baru.</p>
                </div>
                <dl className="grid gap-3 md:grid-cols-2">
                    {GLOSSARY.map(([term, definition]) => (
                        <div key={term} className="rounded-lg border bg-card p-4 print:break-inside-avoid">
                            <dt className="font-semibold">{term}</dt>
                            <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{definition}</dd>
                        </div>
                    ))}
                </dl>
            </section>

            <section aria-labelledby="masalah-umum" className="space-y-4">
                <div>
                    <h2 id="masalah-umum" className="text-xl font-semibold">Masalah umum</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Langkah awal sebelum menghubungi administrator.</p>
                </div>
                <div className="space-y-3">
                    {TROUBLESHOOTING.map((item) => (
                        <details key={item.problem} className="group rounded-lg border bg-card print:break-inside-avoid" open={false}>
                            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-3 font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                                {item.problem}
                                <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
                            </summary>
                            <p className="border-t px-4 py-3 text-sm leading-relaxed text-muted-foreground">{item.answer}</p>
                        </details>
                    ))}
                </div>
            </section>

            <section aria-labelledby="praktik-aman" className="space-y-4">
                <div>
                    <h2 id="praktik-aman" className="text-xl font-semibold">Tips keamanan, perangkat seluler, dan aksesibilitas</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Kebiasaan sederhana untuk penggunaan yang lebih aman dan nyaman.</p>
                </div>
                <div className="grid gap-4 lg:grid-cols-3">
                    <Card className="print:break-inside-avoid print:shadow-none">
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <LockKeyhole className="h-5 w-5 text-primary" aria-hidden="true" />
                                <CardTitle className="text-lg">Keamanan</CardTitle>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <ul className="space-y-2 text-sm text-muted-foreground">
                                <li>• Jangan berbagi akun, kata sandi, atau berkas arsip melalui saluran tidak resmi.</li>
                                <li>• Verifikasi rekod dan penerima sebelum mengunduh atau meneruskan dokumen.</li>
                                <li>• Keluar dari aplikasi setelah memakai perangkat bersama.</li>
                            </ul>
                        </CardContent>
                    </Card>
                    <Card className="print:break-inside-avoid print:shadow-none">
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <Smartphone className="h-5 w-5 text-primary" aria-hidden="true" />
                                <CardTitle className="text-lg">Ponsel & tablet</CardTitle>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <ul className="space-y-2 text-sm text-muted-foreground">
                                <li>• Gunakan tombol <Menu className="inline h-4 w-4" aria-label="menu" /> di header untuk membuka sidebar.</li>
                                <li>• Geser tabel secara horizontal bila kolom belum terlihat.</li>
                                <li>• Untuk input panjang, gunakan layar lanskap atau komputer bila memungkinkan.</li>
                            </ul>
                        </CardContent>
                    </Card>
                    <Card className="print:break-inside-avoid print:shadow-none">
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <Laptop className="h-5 w-5 text-primary" aria-hidden="true" />
                                <CardTitle className="text-lg">Aksesibilitas</CardTitle>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <ul className="space-y-2 text-sm text-muted-foreground">
                                <li>• Gunakan Tab dan Shift+Tab untuk berpindah kontrol dengan papan ketik.</li>
                                <li>• Perbesar tampilan browser bila teks terlalu kecil; susunan halaman akan menyesuaikan.</li>
                                <li>• Gunakan judul bagian dan tombol lompat topik untuk menavigasi lebih cepat.</li>
                            </ul>
                        </CardContent>
                    </Card>
                </div>
            </section>

            <Alert className="print:break-inside-avoid">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                <AlertTitle>Butuh bantuan lebih lanjut?</AlertTitle>
                <AlertDescription>
                    Catat halaman, waktu kejadian, dan pesan kesalahan lalu hubungi administrator SIMSA. Jangan menyertakan kata sandi atau mengirim dokumen arsip melalui kanal bantuan yang tidak disetujui.
                </AlertDescription>
            </Alert>
        </article>
    )
}
