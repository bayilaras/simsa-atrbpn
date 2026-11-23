import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
    Archive,
    BookOpen,
    CheckCircle2,
    ChevronRight,
    CircleHelp,
    Clock3,
    ExternalLink,
    FileCheck2,
    FileSearch,
    FolderTree,
    KeyRound,
    Laptop,
    LockKeyhole,
    Mail,
    Menu,
    Printer,
    Reply,
    Rocket,
    RotateCcw,
    Scale,
    Search,
    Send,
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
import { useAppConfig } from '@/context/app-config-context'
import { PASSWORD_MIN_LENGTH } from '@/lib/password-policy'

// Situs panduan lengkap (docs-site/, docusaurus.config.js `url`).
const ALAMAT_PANDUAN_LENGKAP = 'https://simsa-atrbpn.vercel.app'

const ALL_ROLES = ['super_admin', 'admin_unit', 'admin_dirjen', 'admin_sesditjen', 'staff', 'auditor']
const ADMIN_ROLES = ['super_admin', 'admin_unit', 'admin_dirjen', 'admin_sesditjen']
const STAFF_AND_ADMIN = ADMIN_ROLES
const ADMIN_AND_AUDITOR = [...ADMIN_ROLES, 'auditor']

const ROLE_LABELS = {
    semua: 'Semua peran',
    super_admin: 'Super Admin',
    admin_unit: 'Admin Unit Kerja',
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

// Setiap topik hanya memuat ringkasan. Langkah lengkap beserta gambar ada di
// situs panduan (docs-site/); `docs` menunjuk halamannya dan diperiksa oleh
// UserGuide.test.jsx terhadap berkas di docs-site/docs.
const GUIDE_SECTIONS = [
    {
        id: 'mulai-inventaris-internal',
        category: 'dasar',
        title: 'Mulai inventaris arsip internal',
        summary: 'Catat metadata dan lokasi arsip fisik, lalu temukan kembali tanpa harus mengunggah hasil pindai.',
        icon: Archive,
        roles: ALL_ROLES,
        keywords: ['mulai', 'inventaris', 'fisik', 'csv', 'xlsx', 'excel', 'impor', 'tambah arsip', 'filing cabinet', 'laci', 'folder', 'lokasi', 'akun', 'unit kerja', 'srikandi'],
        points: [
            'Admin mencatat surat melalui formulir atau Impor CSV/XLSX, dan arsip yang sudah ada melalui Tambah Arsip atau Impor CSV di Arsip Aktif.',
            'No. Filing Cabinet, No. Laci, dan No. Folder diisi saat mengarsipkan atau ikut diimpor, sehingga berkas fisik dapat ditemukan kembali.',
            'Inventaris dapat dicatat tanpa lampiran digital. Akun atau koneksi SRIKANDI tidak diperlukan.',
        ],
        docs: [
            { label: 'Mulai Inventaris Internal', path: '/mulai-inventaris-internal' },
            { label: 'Menambah arsip tanpa surat', path: '/siklus-arsip/arsip-aktif#menambah-arsip-tanpa-surat' },
        ],
        action: { label: 'Buka Arsip Aktif', to: '/arsip/masuk' },
    },
    {
        id: 'masuk-dan-navigasi',
        category: 'dasar',
        title: 'Masuk dan mengenali aplikasi',
        summary: 'Login, membaca Dashboard, memakai sidebar, breadcrumb, dan pencarian.',
        icon: Rocket,
        roles: ALL_ROLES,
        keywords: ['login', 'google', 'dashboard', 'sidebar', 'menu', 'navigasi', 'pencarian', 'breadcrumb'],
        points: [
            'Buka SIMSA di https://simsa-frontend.vercel.app dan masuk dengan email serta kata sandi akun pribadi. Login Google digunakan hanya jika telah diaktifkan administrator.',
            'Dashboard menampilkan ringkasan pekerjaan sesuai unit kerja dan kewenangan Anda. Sidebar dipakai untuk berpindah fitur; di layar kecil, buka lewat tombol menu di bagian atas.',
            'Jika suatu menu tidak terlihat, periksa peran akun Anda atau hubungi administrator.',
        ],
        docs: [
            { label: 'Login email dan kata sandi', path: '/akses-simsa/login-email-password' },
            { label: 'Mengenal Dashboard', path: '/tutorial-dasar/mengenal-dashboard' },
            { label: 'Navigasi sidebar', path: '/tutorial-dasar/navigasi-sidebar' },
        ],
        action: { label: 'Buka Dashboard', to: '/' },
    },
    {
        id: 'ganti-kata-sandi',
        category: 'dasar',
        title: 'Mengganti kata sandi',
        summary: 'Ganti kata sandi awal dari administrator melalui Pengaturan › Profil.',
        icon: KeyRound,
        roles: ALL_ROLES,
        keywords: ['kata sandi', 'password', 'ganti kata sandi', 'ubah kata sandi', 'profil', 'pengaturan', 'akun', 'google'],
        points: [
            'Buka menu akun di kanan atas, pilih Pengaturan, lalu isi kartu Ubah Kata Sandi pada tab Profil.',
            `Kata sandi baru minimal ${PASSWORD_MIN_LENGTH} karakter. Setelah diubah, sesi SIMSA di perangkat lain ditutup.`,
            'Akun yang masuk dengan Google tidak memiliki kata sandi SIMSA.',
        ],
        docs: [
            { label: 'Ubah kata sandi', path: '/administrasi/settings#ubah-kata-sandi' },
        ],
        action: { label: 'Buka Pengaturan', to: '/settings' },
    },
    {
        id: 'surat-masuk-keluar',
        category: 'surat',
        title: 'Mengelola surat masuk dan keluar',
        summary: 'Admin mencatat metadata surat melalui formulir atau impor CSV dan menelusurinya kembali.',
        icon: Mail,
        roles: ADMIN_ROLES,
        keywords: ['surat masuk', 'surat keluar', 'distribusi', 'metadata', 'lampiran', 'csv', 'xlsx', 'excel', 'google sheets', 'impor', 'pratinjau', 'sinkron', 'tanggal diterima', 'sifat', 'klasifikasi keamanan', 'terbatas', 'rahasia'],
        points: [
            'Cari dahulu nomor atau perihalnya agar surat tidak tercatat ganda, lalu catat melalui formulir atau Impor CSV/XLSX: pilih satu unit kerja, periksa Pratinjau, lalu Impor.',
            'Sifat surat masuk sekaligus menjadi klasifikasi keamanannya. Rahasia dan Sangat Rahasia hanya dapat ditetapkan atau diimpor oleh Super Admin.',
            'Surat Terbatas, Rahasia, atau Sangat Rahasia hanya dapat dibuka atau diubah dengan persetujuan akses berjangka, juga oleh pencatatnya.',
        ],
        docs: [
            { label: 'Surat Masuk', path: '/manajemen-surat/surat-masuk' },
            { label: 'Surat Keluar', path: '/manajemen-surat/surat-keluar' },
            { label: 'Aturan impor CSV/XLSX', path: '/panduan-pengguna#impor-daftar-csv-atau-xlsx' },
        ],
        action: { label: 'Buka Surat Masuk', to: '/surat/masuk' },
    },
    {
        id: 'persetujuan-surat-keluar',
        category: 'surat',
        title: 'Persetujuan surat keluar sebelum diarsipkan',
        summary: 'Surat keluar diajukan, disetujui, lalu baru dapat diarsipkan; beberapa surat dapat diproses sekaligus.',
        icon: Send,
        roles: ADMIN_ROLES,
        keywords: ['persetujuan', 'ajukan persetujuan', 'setujui', 'tolak', 'penyetuju', 'arsipkan', 'surat keluar', 'massal', 'perlu perbaikan', 'draft'],
        points: [
            'Surat keluar yang baru dicatat berstatus Draft. Pembuat menekan Ajukan Persetujuan dan memilih penyetuju; penyetuju memilih Setujui atau Tolak, dan penolakan wajib disertai catatan.',
            'Tombol Arsipkan baru muncul setelah surat berstatus Disetujui. Beberapa surat dapat diajukan atau disetujui sekaligus dari daftar Surat Keluar.',
        ],
        docs: [
            { label: 'Persetujuan internal surat keluar', path: '/manajemen-surat/surat-keluar#persetujuan-internal-surat-keluar' },
        ],
        action: { label: 'Buka Surat Keluar', to: '/surat/keluar' },
    },
    {
        id: 'tindak-lanjut-surat',
        category: 'surat',
        title: 'Menu Tindak Lanjut',
        summary: 'Membalas, membuat nota dinas, mendisposisikan, atau menautkan surat langsung dari halaman detailnya.',
        icon: Reply,
        roles: ADMIN_ROLES,
        keywords: ['tindak lanjut', 'balas', 'saya balas', 'nota dinas', 'nd penjelas', 'disposisi', 'terima disposisi', 'penyelesaian', 'rangkaian', 'tautkan', 'cetak disposisi', 'lembar disposisi'],
        points: [
            'Tombol Tindak Lanjut ada di detail surat masuk dan surat keluar. Pilihan yang tampil mengikuti kewenangan Anda atas surat itu.',
            'Saya Balas dan Buat Nota Dinas membuka formulir Tambah Surat Keluar dengan Nomor Referensi surat asal yang sudah terisi. Disposisi ke Direktorat mengirim surat masuk ke unit tujuan.',
        ],
        docs: [
            { label: 'Membalas surat masuk', path: '/manajemen-surat/surat-masuk#membalas-surat-masuk' },
            { label: 'Distribusi dan disposisi', path: '/manajemen-surat/distribusi' },
        ],
        action: { label: 'Buka Surat Masuk', to: '/surat/masuk' },
    },
    {
        id: 'lacak-surat',
        category: 'surat',
        title: 'Lacak Surat',
        summary: 'Menelusuri surat masuk dan keluar beserta rangkaian tindak lanjutnya dalam satu pencarian.',
        icon: Search,
        roles: ALL_ROLES,
        keywords: ['lacak', 'lacak surat', 'telusur', 'rangkaian', 'berkas rangkaian', 'perlu dilengkapi', 'nomor surat', 'alur surat'],
        points: [
            'Buka Surat › Lacak Surat di sidebar, lalu ketik nomor surat atau kata dalam perihal.',
            'Tab Berkas Rangkaian menampilkan rangkaian surat yang dapat Anda lihat. Tab Perlu Dilengkapi menampilkan surat yang rantainya belum lengkap.',
        ],
        docs: [
            { label: 'Rangkaian Surat dan Lacak Surat', path: '/manajemen-surat/rangkaian-surat#melacak-rangkaian' },
        ],
        action: { label: 'Buka Lacak Surat', to: '/surat/lacak' },
    },
    {
        id: 'surat-terhapus',
        category: 'surat',
        title: 'Menemukan surat yang terhapus',
        summary: 'Super Admin dapat melihat dan memulihkan surat yang sudah dihapus.',
        icon: RotateCcw,
        roles: ['super_admin'],
        keywords: ['terhapus', 'surat terhapus', 'hapus', 'pulihkan', 'kembalikan surat', 'super admin', 'nomor agenda', 'nomor urut'],
        points: [
            'Hanya Super Admin yang dapat melihat dan memulihkannya: buka Surat Masuk atau Surat Keluar, lalu pilih tab Surat Terhapus di atas daftar.',
            'Tekan Pulihkan dan isi alasannya. Surat kembali dengan nomor semula; pemulihan tidak dapat dilakukan selama nomor agenda atau nomor urutnya dipakai surat lain.',
        ],
        docs: [
            { label: 'Memulihkan surat yang terhapus', path: '/manajemen-surat/surat-masuk#memulihkan-surat-yang-terhapus' },
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
        keywords: ['arsip aktif', 'detail arsip', 'klasifikasi', 'lokasi', 'status', 'ubah metadata'],
        points: [
            'Buka Arsip Aktif, lalu cari dengan nomor atau perihal dan filter yang spesifik.',
            'Halaman detail memuat metadata, klasifikasi, berkas, lokasi simpan, dan informasi retensi arsip.',
        ],
        docs: [
            { label: 'Arsip Aktif', path: '/siklus-arsip/arsip-aktif' },
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
        keywords: ['dosir', 'pemberkasan', 'berkas', 'lokasi simpan', 'fisik', 'filing cabinet', 'laci', 'folder'],
        points: [
            'Dosir mengelompokkan arsip dari urusan atau kegiatan yang sama, bukan hanya karena judulnya mirip.',
            'Catat lokasi simpan fisik secara konsisten agar rekod digital dapat ditelusuri ke medianya.',
        ],
        docs: [
            { label: 'Dosir', path: '/siklus-arsip/dosir' },
            { label: 'Lokasi simpan', path: '/layanan-fisik/lokasi-simpan' },
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
        keywords: ['jra', 'jadwal retensi', 'klasifikasi', 'aktif', 'inaktif', 'nasib akhir', 'versi aturan', 'katalog'],
        points: [
            'Pilih klasifikasi menurut fungsi atau kegiatan yang menghasilkan arsip, lalu cocokkan uraian JRA-nya; jangan menentukan retensi hanya dari judul dokumen.',
            'Katalog berlaku untuk seluruh unit. Versi baru disiapkan dan diaktifkan oleh Super Admin, dan histori aturan lama tidak diubah.',
        ],
        docs: [
            { label: 'Klasifikasi arsip dan JRA', path: '/panduan-pengguna#8-klasifikasi-arsip-dan-jra' },
            { label: 'Versi aturan', path: '/administrasi/versi-aturan' },
        ],
        actionByRole: {
            super_admin: { label: 'Kelola Katalog Aturan', to: '/master/regulatory-rules' },
            admin_unit: { label: 'Buka Surat Masuk', to: '/surat/masuk' },
            admin_dirjen: { label: 'Buka Surat Masuk', to: '/surat/masuk' },
            admin_sesditjen: { label: 'Buka Surat Masuk', to: '/surat/masuk' },
        },
    },
    {
        id: 'tata-kelola-retensi',
        category: 'retensi',
        title: 'Tata kelola retensi dan penilaian',
        summary: 'Verifikasi pemicu, appraisal, legal hold, dan keputusan akhir yang dapat diaudit.',
        icon: Scale,
        roles: ADMIN_AND_AUDITOR,
        keywords: ['pemicu retensi', 'verifikasi', 'appraisal', 'legal hold', 'musnah', 'permanen', 'review'],
        points: [
            'Verifikasi pemicu retensi berdasarkan bukti, dan catat appraisal menurut JRA yang berlaku. Pengusul dan pemeriksa harus petugas berbeda bila alur meminta pemeriksaan independen.',
            'Arsip yang terkena legal hold tidak boleh dilanjutkan ke pemusnahan.',
        ],
        docs: [
            { label: 'Retensi, appraisal, pemicu, dan legal hold', path: '/panduan-pengguna#9-retensi-appraisal-pemicu-dan-legal-hold' },
            { label: 'Manajemen Retensi', path: '/siklus-arsip/manajemen-retensi' },
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
        keywords: ['penyusutan', 'pemusnahan', 'penyerahan', 'permanen', 'manifest', 'bukti', 'legal hold', 'berita acara'],
        points: [
            'Mulai hanya dari arsip yang keputusan akhirnya sudah sah dan tidak sedang terkena legal hold.',
            'Serah-terima dan penerimaan dilakukan oleh pejabat berbeda. Bila proses harus dibatalkan, gunakan alur pembatalan agar alasan dan riwayatnya tetap tercatat.',
        ],
        docs: [
            { label: 'Penyusutan', path: '/siklus-arsip/penyusutan' },
            { label: 'Manifest penyerahan permanen', path: '/panduan-pengguna#manifest-penyerahan-permanen' },
        ],
        action: { label: 'Buka Penyusutan', to: '/penyusutan' },
        optionalModule: 'advancedArchiveWorkflows',
        // Ditampilkan selama modul Penyusutan dimatikan agar panduan tidak
        // mengarahkan ke halaman "Modul belum diaktifkan".
        moduleOff: {
            summary: 'Modul Penyusutan belum diaktifkan. Pemindahan dan pemusnahan arsip dilakukan di luar SIMSA.',
            points: [
                'Ikuti prosedur penyusutan yang berlaku di unit Anda; SIMSA hanya menyediakan data pendukungnya, misalnya daftar arsip yang masa retensinya sudah atau hampir habis di Manajemen Retensi.',
                'Draf berita acara pemusnahan tanpa nomor (nomor diisi manual) dapat dicetak dari Manajemen Retensi melalui tombol Generate Berita Acara.',
                'Penyerahan arsip permanen tetap dicatat di Tata Kelola Retensi, tab Penyerahan Permanen.',
            ],
            docs: [
                { label: 'Manajemen Retensi', path: '/siklus-arsip/manajemen-retensi#tindakan-pada-halaman-ini' },
                { label: 'Penyusutan', path: '/siklus-arsip/penyusutan' },
            ],
            action: { label: 'Buka Manajemen Retensi', to: '/retention' },
        },
    },
    {
        id: 'akses-dan-layanan',
        category: 'layanan',
        title: 'Permintaan akses dan layanan arsip',
        summary: 'Menggunakan arsip secara terkendali tanpa mengubah rekod sumber.',
        icon: KeyRound,
        roles: ALL_ROLES,
        keywords: ['akses', 'persetujuan akses', 'minta akses', 'layanan', 'peminjaman', 'izin', 'rekod'],
        points: [
            'Ajukan Persetujuan Akses Rekod bila arsip yang dibutuhkan tidak tersedia bagi akun Anda, dan jelaskan tujuan penggunaannya.',
            'Pengelola yang memiliki menu layanan atau peminjaman mencatat penyerahan dan pengembalian arsip pada proses terkait.',
        ],
        docs: [
            { label: 'Persetujuan Akses', path: '/administrasi/persetujuan-akses' },
            { label: 'Peminjaman', path: '/layanan-fisik/peminjaman' },
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
        points: [
            'Laporan menampilkan data dan pekerjaan unit sesuai peran Anda.',
            'Audit Log hanya dapat dibuka Super Admin.',
        ],
        docs: [
            { label: 'Laporan', path: '/administrasi/laporan' },
            { label: 'Audit Log', path: '/administrasi/audit-log' },
        ],
        actionByRole: {
            super_admin: { label: 'Buka Audit Log', to: '/audit-log' },
            auditor: { label: 'Buka Tata Kelola Retensi', to: '/retention-governance' },
            admin_unit: { label: 'Buka Laporan', to: '/laporan' },
            admin_dirjen: { label: 'Buka Laporan', to: '/laporan' },
            admin_sesditjen: { label: 'Buka Laporan', to: '/laporan' },
            staff: { label: 'Buka Laporan', to: '/laporan' },
        },
    },
]

const ROLE_FLOWS = [
    {
        role: 'super_admin',
        title: 'Super Admin',
        description: 'Mengelola seluruh unit, pengguna, konfigurasi, katalog aturan, dan pengawasan aplikasi.',
        flow: ['Kelola pengguna dan unit', 'Siapkan sumber dan manifest aturan', 'Validasi dan aktifkan katalog', 'Pantau seluruh unit dan audit'],
    },
    {
        role: 'admin_unit',
        title: 'Admin Unit Kerja',
        description: 'Mengelola surat, arsip, retensi, penyimpanan, template, dan layanan pada unit yang ditetapkan Super Admin.',
        flow: ['Kelola surat unit', 'Klasifikasikan dan berkas-kan', 'Kelola retensi dan layanan', 'Pantau laporan unit'],
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
        problem: 'Tidak dapat login dengan email dan kata sandi',
        answer: 'Buka SIMSA dari alamat resmi https://simsa-frontend.vercel.app dan gunakan akun yang aktif. Periksa ejaan email serta kata sandi. Jika tertulis Origin tidak diizinkan, pastikan alamat di peramban persis https://simsa-frontend.vercel.app atau laporkan alamat halaman kepada operator; mengganti kata sandi tidak memperbaiki kesalahan alamat tersebut.',
    },
    {
        problem: 'Tidak dapat login dengan Google',
        answer: 'Pastikan memakai akun dinas yang sudah diprovisikan, buka dari alamat resmi aplikasi, lalu coba kembali. Jika tetap gagal, kirimkan alamat email dan waktu kejadian kepada administrator—jangan mengirim kata sandi.',
    },
    {
        problem: 'Menu yang dibutuhkan tidak terlihat',
        answer: 'Menu mengikuti peran dan fitur yang diaktifkan. Pastikan Anda masuk dengan akun yang benar, lalu minta administrator memeriksa peran tanpa meminta perluasan akses yang tidak diperlukan.',
    },
    {
        problem: 'Menu unggah tidak tersedia',
        answer: 'Penyimpanan privat dan pemeriksaan file mungkin belum tersedia. Admin tetap dapat mencatat metadata atau mengimpor CSV untuk inventaris fisik. Jangan memasukkan tautan publik atau berkas kosong sebagai pengganti lampiran.',
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
        problem: 'Baris impor surat masuk ditolak karena sifat atau klasifikasi keamanan',
        answer: 'Keterangan “Klasifikasi keamanan melebihi kewenangan pengguna…” berarti baris bersifat Rahasia atau Sangat Rahasia diimpor oleh Admin Unit Kerja, Admin Dirjen, atau Admin Sesditjen; baris seperti itu hanya dapat diimpor oleh Super Admin. Jangan menurunkan sifat pada sumber agar baris lolos; minta Super Admin mengimpor lembar yang sama atau mencatat surat itu melalui formulir surat masuk. Keterangan “Sifat surat tidak dikenal…” berlaku untuk semua pengguna, termasuk Super Admin: perbaiki penulisan sifat pada sumber sesuai dokumen aslinya, lalu impor ulang.',
        docs: { label: 'Aturan impor CSV/XLSX', path: '/panduan-pengguna#impor-daftar-csv-atau-xlsx' },
    },
    {
        problem: 'Sesi berakhir saat bekerja',
        answer: 'Aplikasi mengakhiri sesi yang tidak aktif selama 30 menit untuk keamanan. Masuk kembali, lalu buka lagi formulir surat atau dialog Arsipkan yang sedang diisi di tab yang sama: isian yang belum disimpan ditawarkan untuk dipulihkan. Isian tidak dapat dipulihkan bila tab sudah ditutup atau Anda menekan Keluar, dan berkas PDF yang sudah dipilih perlu dipilih ulang.',
    },
    {
        problem: 'Muncul pemberitahuan versi baru SIMSA',
        answer: 'Simpan dahulu pekerjaan yang sedang diisi, lalu tekan Muat ulang pada pemberitahuan. Halaman tidak dimuat ulang sendiri selama formulir surat atau dialog Arsipkan masih memuat isian yang belum disimpan.',
    },
    {
        problem: 'Unggah berkas PDF lama atau gagal',
        answer: 'Persentase unggahan tampil di bilah tombol di bagian bawah formulir surat selama berkas diunggah. Bila unggahan melewati batas waktu, periksa koneksi internet, kecilkan ukuran PDF (misalnya dengan fitur kompres PDF), pilih berkas yang sudah dikecilkan, lalu simpan kembali; isian formulir tetap ada.',
    },
]

const normalizeSearch = (value) => value.trim().toLocaleLowerCase('id-ID')

const alamatPanduan = (path) => `${ALAMAT_PANDUAN_LENGKAP}${path}`

/** Tautan ke satu halaman situs panduan; selalu membuka tab baru. */
function TautanPanduan({ docs }) {
    return (
        <a
            href={alamatPanduan(docs.path)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
        >
            {docs.label}
            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="sr-only"> (situs panduan, membuka tab baru)</span>
        </a>
    )
}

// Sama dengan sidebar: hanya nilai false eksplisit yang menandai modul mati.
function resolveGuideSections(capabilities = {}) {
    return GUIDE_SECTIONS.map((section) => (
        section.optionalModule && capabilities[section.optionalModule] === false
            ? { ...section, ...section.moduleOff }
            : section
    ))
}

export default function UserGuide() {
    const { user } = useAuth()
    const { capabilities } = useAppConfig()
    const currentRole = ALL_ROLES.includes(user?.role) ? user.role : 'semua'
    const [query, setQuery] = useState('')
    const [category, setCategory] = useState('semua')
    const [roleFilter, setRoleFilter] = useState(currentRole)
    const guideSections = useMemo(() => resolveGuideSections(capabilities), [capabilities])

    const filteredSections = useMemo(() => {
        const normalizedQuery = normalizeSearch(query)

        return guideSections.filter((section) => {
            const matchesCategory = category === 'semua' || section.category === category
            const matchesRole = roleFilter === 'semua' || section.roles.includes(roleFilter)
            const searchableText = [
                section.title,
                section.summary,
                ...section.keywords,
                ...section.points,
                ...section.docs.map((item) => item.label),
            ].join(' ').toLocaleLowerCase('id-ID')

            return matchesCategory && matchesRole && (!normalizedQuery || searchableText.includes(normalizedQuery))
        })
    }, [category, guideSections, query, roleFilter])

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
                description="Ringkasan alur kerja surat dan arsip sesuai peran Anda. Langkah lengkap beserta gambar contoh ada di situs Panduan SIMSA."
                actions={(
                    <div className="flex flex-wrap gap-2 print:hidden">
                        <Button asChild variant="outline" className="min-h-11">
                            <a href={ALAMAT_PANDUAN_LENGKAP} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
                                Panduan lengkap
                                <span className="sr-only"> (membuka tab baru)</span>
                            </a>
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            className="min-h-11"
                            onClick={() => window.print()}
                        >
                            <Printer className="mr-2 h-4 w-4" aria-hidden="true" />
                            Cetak panduan
                        </Button>
                    </div>
                )}
            />

            <Alert className="border-primary/30 bg-primary/5 print:border-border print:bg-transparent">
                <CircleHelp className="h-4 w-4" aria-hidden="true" />
                <AlertTitle>Panduan ini mengikuti kewenangan pengguna</AlertTitle>
                <AlertDescription>
                    {user ? (
                        <>Anda masuk sebagai <strong>{ROLE_LABELS[currentRole] || 'Pengguna'}</strong>. Dua peran utama adalah Super Admin dan Admin Unit Kerja. Akun lama tetap mengikuti akses yang sudah diberikan sampai ditetapkan ulang oleh Super Admin.</>
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
                                {['super_admin', 'admin_unit', ...(!['super_admin', 'admin_unit'].includes(currentRole) && ALL_ROLES.includes(currentRole) ? [currentRole] : [])].map((role) => (
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
                        ['5', 'Periksa hasil', 'Buka kembali detail yang disimpan untuk memastikan datanya benar; akun baca-saja melaporkan koreksi kepada admin unit.'],
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
                    <h2 id="alur-fitur" className="text-xl font-semibold">Ringkasan per fitur</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Setiap topik memuat intinya saja. Tautan “Langkah lengkap” membuka urutan langkah beserta gambar contoh di situs Panduan SIMSA.</p>
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
                                        <ul className="space-y-3">
                                            {section.points.map((point) => (
                                                <li key={point} className="flex gap-3 text-sm leading-relaxed">
                                                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                                                    <span>{point}</span>
                                                </li>
                                            ))}
                                        </ul>
                                        <div className="rounded-md bg-muted/40 px-3 py-2 text-sm print:bg-transparent print:px-0">
                                            <p className="font-medium">Langkah lengkap dengan gambar</p>
                                            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1" aria-label={`Halaman situs panduan untuk ${section.title}`}>
                                                {section.docs.map((item) => (
                                                    <li key={item.path}><TautanPanduan docs={item} /></li>
                                                ))}
                                            </ul>
                                        </div>
                                        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 print:hidden">
                                            <div className="flex flex-wrap gap-1.5" aria-label="Peran yang dapat mengakses fitur">
                                                {section.roles.filter(role => ['super_admin', 'admin_unit'].includes(role)).map((role) => (
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
                            <div className="space-y-2 border-t px-4 py-3 text-sm leading-relaxed">
                                <p className="text-muted-foreground">{item.answer}</p>
                                {item.docs && <p>Selengkapnya: <TautanPanduan docs={item.docs} /></p>}
                            </div>
                        </details>
                    ))}
                </div>
                <p className="text-sm text-muted-foreground">
                    Masalah lain dan cara menanganinya:{' '}
                    <TautanPanduan docs={{ label: 'Pemecahan masalah', path: '/panduan-pengguna#17-pemecahan-masalah' }} />
                </p>
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
                    <p>
                        Panduan lengkap tersedia di situs Panduan SIMSA:{' '}
                        <a href={ALAMAT_PANDUAN_LENGKAP} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline underline-offset-4">
                            {ALAMAT_PANDUAN_LENGKAP.replace('https://', '')}
                            <span className="sr-only"> (membuka tab baru)</span>
                        </a>.
                    </p>
                    <p className="mt-2">Hubungi Super Admin unit Anda bila masih ada kendala.</p>
                    <p className="mt-2">
                        Catat halaman, waktu kejadian, dan pesan kesalahan sebelum menghubungi. Jangan menyertakan kata sandi atau mengirim dokumen arsip melalui kanal bantuan yang tidak disetujui.
                    </p>
                </AlertDescription>
            </Alert>
        </article>
    )
}
