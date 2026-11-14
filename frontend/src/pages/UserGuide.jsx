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

const GUIDE_SECTIONS = [
    {
        id: 'mulai-inventaris-internal',
        category: 'dasar',
        title: 'Mulai inventaris arsip internal',
        summary: 'Catat metadata dan lokasi arsip fisik, lalu temukan kembali tanpa harus mengunggah hasil pindai.',
        icon: Archive,
        roles: ALL_ROLES,
        keywords: ['mulai', 'inventaris', 'fisik', 'csv', 'impor', 'akun', 'unit kerja', 'srikandi'],
        steps: [
            'Masuk dengan email dan kata sandi dari administrator. Gunakan akun pribadi dengan peran dan unit kerja yang benar: Super Admin mengelola seluruh unit, sedangkan Admin Unit Kerja mencatat dan mengubah data unitnya sendiri. Akun lama Staf atau Auditor hanya dapat membaca data.',
            'Admin membuka Surat Masuk atau Surat Keluar, mencari nomor yang sama lebih dahulu, lalu mencatat metadata. Untuk daftar yang sudah tersedia (CSV atau Excel .xlsx), pilih satu unit kerja dan gunakan Impor CSV/XLSX → Pratinjau → Impor; judul kolom dikenali seperti impor Google Sheets. Pada surat masuk, kolom Sifat Surat sekaligus menjadi klasifikasi keamanan: baris Rahasia atau Sangat Rahasia hanya dapat diimpor oleh Super Admin. Bila Admin Unit Kerja, Admin Dirjen, atau Admin Sesditjen mengimpornya, baris itu ditolak dan baris lain tetap tersimpan.',
            'Untuk inventaris arsip yang sudah ada, admin membuka Arsip Aktif → Arsip Surat Masuk atau Arsip Surat Keluar lalu Impor CSV. Isi tanggal sumber yang benar; impor tidak otomatis memverifikasi klasifikasi atau JRA.',
            'Saat mengarsipkan surat yang selesai diproses, isi klasifikasi/JRA yang sesuai serta No. Filing Cabinet, No. Laci, dan No. Folder pada dialog Arsipkan. Pada CSV arsip, catatan lokasi dapat dimasukkan ke Keterangan; kolom lokasi terstruktur belum dipetakan oleh impor.',
            'Temukan kembali arsip melalui nomor atau uraian, filter unit/tahun, dan halaman detail. Cocokkan catatan lokasi dengan berkas fisik sebelum menyerahkannya kepada peminjam.',
            'SIMSA mengelola surat dan arsip secara mandiri; koneksi atau akun SRIKANDI tidak diperlukan. Inventaris dapat dicatat tanpa lampiran digital. Gunakan instrumen ATR/BPN yang berlaku; tambahkan lampiran setelah penyimpanan privat dan pemeriksaan file siap.',
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
        keywords: ['login', 'google', 'dashboard', 'sidebar', 'menu', 'navigasi', 'pencarian'],
        steps: [
            'Buka SIMSA di https://simsa-frontend.vercel.app dan masuk dengan email serta kata sandi akun pribadi. Login Google digunakan hanya jika telah diaktifkan administrator.',
            'Gunakan Dashboard untuk melihat ringkasan pekerjaan sesuai unit kerja dan kewenangan Anda.',
            'Buka sidebar untuk berpindah fitur. Di layar kecil, gunakan tombol menu pada bagian atas.',
            'Gunakan breadcrumb di atas halaman untuk mengetahui posisi dan kembali ke bagian sebelumnya.',
            'Jika suatu menu tidak terlihat, periksa peran akun Anda atau hubungi administrator.',
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
        keywords: ['kata sandi', 'password', 'ganti kata sandi', 'ubah kata sandi', 'profil', 'pengaturan', 'akun'],
        steps: [
            'Buka menu akun di kanan atas, lalu pilih Pengaturan. Halaman Pengaturan terbuka pada tab Profil.',
            'Pada kartu Ubah Kata Sandi, isi Kata sandi saat ini, Kata sandi baru, dan Konfirmasi kata sandi baru, lalu tekan Simpan Kata Sandi.',
            `Kata sandi baru minimal ${PASSWORD_MIN_LENGTH} karakter, tidak memuat nama atau bagian depan email Anda, dan bukan kata sandi yang umum.`,
            'Setelah kata sandi diubah, sesi SIMSA di perangkat lain ditutup.',
            'Akun yang masuk dengan Google tidak memiliki kata sandi SIMSA. Bila perlu masuk dengan email dan kata sandi, minta Super Admin mengaturnya melalui Manajemen Pengguna.',
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
        keywords: ['surat masuk', 'surat keluar', 'distribusi', 'metadata', 'lampiran', 'csv', 'impor'],
        steps: [
            'Pilih Surat Masuk atau Surat Keluar dari sidebar sesuai naskah yang akan dikelola.',
            'Cari dahulu berdasarkan nomor, perihal, pengirim, atau penerima untuk mencegah pencatatan ganda.',
            'Isi metadata dari dokumen sumber secara lengkap dan periksa kembali tanggal serta nomor surat. Pada formulir surat masuk, admin dapat memilih sifat Terbatas, sedangkan sifat Rahasia dan Sangat Rahasia hanya dapat ditetapkan oleh Super Admin. Surat Terbatas, Rahasia, atau Sangat Rahasia hanya dapat dibuka atau diubah dengan persetujuan akses berjangka, juga oleh pencatatnya; ajukan persetujuan akses setelah menyimpan.',
            'Untuk daftar CSV atau XLSX, pilih unit kerja konkret lalu Impor CSV/XLSX dan Pratinjau (pilih lembar kerja bila ada beberapa). Periksa pemetaan kolom, lalu Impor; perbaiki judul atau baris yang ditolak karena data tidak lengkap atau tidak valid pada berkas sumber dan periksa hasil karena sebagian baris dapat berhasil saat baris lain gagal.',
            'Sifat surat masuk sekaligus menjadi klasifikasi keamanan. Tulis Sifat Surat sebagai Biasa, Terbatas, Rahasia, atau Sangat Rahasia; sifat urgensi Segera, Sangat Segera, Amat Segera/Kilat, Penting, dan Undangan dibaca Biasa, begitu pula sel kosong atau “-”. Baris surat baru dengan sifat lain ditolak untuk semua pengguna, termasuk Super Admin, dengan keterangan “Sifat surat tidak dikenal…”. Pratinjau mencantumkan baris yang akan ditolak beserta alasannya sebelum Impor; periksa juga Rincian hasil impor per baris setelah Impor. Impor surat keluar tidak terpengaruh karena sifatnya adalah urgensi.',
            'Baris surat masuk Rahasia atau Sangat Rahasia hanya dapat diimpor oleh Super Admin. Bila diimpor Admin Unit Kerja, Admin Dirjen, atau Admin Sesditjen, baris itu ditolak dengan keterangan “Klasifikasi keamanan melebihi kewenangan pengguna…”, tidak dicocokkan dengan surat yang sudah tercatat (juga saat sinkron), dan baris lain tetap tersimpan. Minta Super Admin mengimpor lembar yang sama atau mencatat surat itu melalui formulir surat masuk, yang menyediakan pilihan Rahasia dan Sangat Rahasia bagi Super Admin. Surat Rahasia atau Sangat Rahasia yang diimpor Super Admin tidak tampil bagi admin tersebut tanpa persetujuan akses rekod.',
            'Periksa Rincian hasil impor per baris (filter Perlu dicek) atau unduh laporannya sebagai CSV. Bila sumber diubah setelah diimpor, centang Sinkronkan surat yang sudah tercatat sebelum mengimpor ulang; perubahan dicatat di log audit, sel kosong tidak menghapus data, sifat surat masuk tidak ikut diubah, dan surat yang sedang atau telah disetujui, diarsipkan, dihapus, atau tidak boleh Anda ubah tetap seperti semula.',
            'Simpan metadata dan pastikan detailnya dapat dibuka. Tambahkan lampiran hanya bila fasilitas penyimpanan file tersedia dan berkasnya memang terkait; arsip fisik tidak memerlukan unggahan pengganti.',
            'Gunakan Distribusi bila menu tersebut tersedia dan tindak lanjut memang diperlukan.',
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
        keywords: ['persetujuan', 'ajukan persetujuan', 'setujui', 'tolak', 'penyetuju', 'arsipkan', 'surat keluar', 'massal', 'perlu perbaikan'],
        steps: [
            'Surat keluar yang baru dicatat berstatus Draft. Tombol Arsipkan baru muncul setelah surat berstatus Disetujui.',
            'Pembuat surat membuka detail surat, menekan Ajukan Persetujuan, lalu memilih penyetuju: administrator aktif lain untuk unit surat itu atau Super Admin.',
            'Penyetuju membuka surat yang menunggu keputusannya lalu menekan Setujui atau Tolak. Penolakan wajib disertai catatan; surat yang ditolak berstatus Perlu Perbaikan, dapat diubah, lalu diajukan kembali.',
            'Untuk beberapa surat sekaligus, centang surat di daftar Surat Keluar, lalu pilih Ajukan Persetujuan atau Setujui pada bilah di atas daftar. Setiap surat tetap diperiksa satu per satu; surat yang tidak dapat diproses disebutkan beserta alasannya.',
            'Jumlah surat yang menunggu keputusan Anda tampil pada menu Surat Keluar dan di Dashboard.',
            'Setelah Disetujui, pilih Arsipkan pada detail surat atau pada menu baris di daftar. Persetujuan ini adalah persetujuan internal SIMSA, bukan tanda tangan elektronik BSrE/PSrE.',
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
        keywords: ['tindak lanjut', 'balas', 'saya balas', 'nota dinas', 'nd penjelas', 'disposisi', 'terima disposisi', 'penyelesaian', 'rangkaian', 'tautkan'],
        steps: [
            'Buka detail surat masuk atau surat keluar, lalu tekan tombol Tindak Lanjut. Pilihan yang tampil mengikuti kewenangan Anda atas surat itu.',
            'Saya Balas dan Buat Nota Dinas membuka formulir Tambah Surat Keluar dengan Nomor Referensi surat asal yang sudah terisi. Buat ND Penjelas tersedia untuk surat keluar berjenis Keputusan.',
            'Pada surat masuk, Disposisi ke Direktorat mengirim surat ke unit tujuan. Unit penerima memilih Terima Disposisi, lalu Penyelesaian setelah disposisinya ditindaklanjuti.',
            'Tautkan ke Rangkaian menghubungkan surat dengan surat lain dalam satu rangkaian agar alurnya dapat dilacak.',
            'Dari daftar Surat Keluar, pilihan Tindak Lanjut Surat Masuk… membuka formulir baru dan langsung meminta Anda memilih surat yang ditindaklanjuti.',
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
        keywords: ['lacak', 'lacak surat', 'telusur', 'rangkaian', 'berkas rangkaian', 'perlu dilengkapi', 'nomor surat'],
        steps: [
            'Buka Surat › Lacak Surat di sidebar.',
            'Pada tab Lacak, ketik nomor surat (misalnya B-12/PTPP.1/IX/2024) atau kata dalam perihal. Hasil memuat surat masuk dan keluar yang boleh Anda lihat beserta rangkaian tindak lanjutnya.',
            'Tab Berkas Rangkaian menampilkan rangkaian surat yang dapat Anda lihat.',
            'Tab Perlu Dilengkapi menampilkan surat dan rangkaian dalam jangkauan Anda yang rantainya belum lengkap, misalnya surat masuk yang belum ditindaklanjuti atau disposisi yang belum selesai. Bagi admin, angka pada menu Lacak Surat menunjukkan jumlahnya.',
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
        keywords: ['terhapus', 'surat terhapus', 'hapus', 'pulihkan', 'kembalikan surat', 'super admin'],
        steps: [
            'Surat yang dihapus tidak lagi tampil di daftar. Hanya Super Admin yang dapat melihat dan memulihkannya; admin lain meminta bantuan Super Admin.',
            'Buka Surat Masuk atau Surat Keluar, lalu pilih tab Surat Terhapus di atas daftar.',
            'Cari surat, periksa alasan penghapusannya, lalu tekan Pulihkan dan isi alasan pemulihan minimal 10 karakter.',
            'Surat kembali ke daftar dengan nomor agenda atau nomor urut dan nomor surat semula, dan pemulihannya dicatat di log audit. Bila nomor surat yang sama dipakai surat aktif lain di unit itu, pemberitahuan setelah pemulihan menyebutkannya.',
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
            'Admin Unit Kerja memilih klasifikasi dan JRA aktif saat mencatat surat atau arsip. Katalog berlaku untuk seluruh unit.',
            'Super Admin menyiapkan PDF resmi, manifest, dan analisis dampak, lalu memvalidasi dan langsung mengaktifkan versi baru.',
            'Jangan mengubah histori aturan lama untuk menyesuaikan aturan baru.',
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
        optionalModule: 'advancedArchiveWorkflows',
        // Ditampilkan selama modul Penyusutan dimatikan agar panduan tidak
        // mengarahkan ke halaman "Modul belum diaktifkan".
        moduleOff: {
            summary: 'Modul Penyusutan belum diaktifkan. Pemindahan dan pemusnahan arsip dilakukan di luar SIMSA.',
            steps: [
                'Ikuti prosedur penyusutan yang berlaku di unit Anda; SIMSA hanya menyediakan data pendukungnya.',
                'Penyerahan arsip permanen tetap dicatat di Tata Kelola Retensi, tab Penyerahan Permanen.',
                'Gunakan Manajemen Retensi untuk melihat arsip yang masa retensinya sudah atau hampir habis sebagai bahan usulan.',
                'Pastikan keputusan retensi sudah sah dan arsip tidak sedang terkena legal hold sebelum diproses.',
                'Draf berita acara pemusnahan tanpa nomor (nomor diisi manual) dapat dicetak dari Manajemen Retensi melalui tombol Generate Berita Acara.',
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
        answer: 'Keterangan “Klasifikasi keamanan melebihi kewenangan pengguna…” berarti baris bersifat Rahasia atau Sangat Rahasia diimpor oleh Admin Unit Kerja, Admin Dirjen, atau Admin Sesditjen; baris seperti itu hanya dapat diimpor oleh Super Admin. Jangan menurunkan sifat pada sumber agar baris lolos. Minta Super Admin mengimpor lembar yang sama atau mencatat surat itu melalui formulir surat masuk, yang menyediakan pilihan Rahasia dan Sangat Rahasia bagi Super Admin. Impor ulang oleh admin tersebut tetap melaporkan baris itu Ditolak walaupun Super Admin sudah mengimpornya, dan surat Rahasia atau Sangat Rahasia itu tidak tampil bagi admin tersebut tanpa persetujuan akses rekod. Keterangan “Sifat surat tidak dikenal…” berlaku untuk semua pengguna, termasuk Super Admin: sifat pada sumber bukan Biasa, Terbatas, Rahasia, Sangat Rahasia, atau sifat urgensi Segera, Sangat Segera, Amat Segera/Kilat, Penting, atau Undangan. Perbaiki penulisan sifat pada sumber sesuai dokumen aslinya lalu impor ulang; sel kosong atau “-” dicatat sebagai Biasa.',
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
                ...section.steps,
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
                description="Pelajari alur kerja pengelolaan surat dan arsip secara bertahap sesuai peran Anda."
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
