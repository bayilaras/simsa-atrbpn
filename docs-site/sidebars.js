/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  panduanSidebar: [
    'index',
    'profil-aplikasi-internal',
    {
      type: 'category',
      label: '🔐 Akses SIMSA',
      collapsed: false,
      items: [
        'akses-simsa/wajib-baca',
        'akses-simsa/login-email-password',
        'akses-simsa/daftar-email',
        'akses-simsa/login-google',
      ],
    },
    {
      type: 'category',
      label: '📖 Tutorial Dasar',
      items: [
        'tutorial-dasar/browser-kompatibel',
        'tutorial-dasar/mengenal-dashboard',
        'tutorial-dasar/navigasi-sidebar',
        'tutorial-dasar/role-hak-akses',
      ],
    },
    {
      type: 'category',
      label: '📬 Manajemen Surat',
      items: [
        'manajemen-surat/surat-masuk',
        'manajemen-surat/surat-keluar',
        'manajemen-surat/distribusi',
      ],
    },
    {
      type: 'category',
      label: '🗂️ Siklus Hidup Arsip',
      items: [
        'siklus-arsip/arsip-aktif',
        'siklus-arsip/dosir',
        'siklus-arsip/jadwal-retensi',
        'siklus-arsip/manajemen-retensi',
        'siklus-arsip/penyusutan',
      ],
    },
    {
      type: 'category',
      label: '📋 Layanan & Fisik',
      items: [
        'layanan-fisik/layanan-arsip',
        'layanan-fisik/peminjaman',
        'layanan-fisik/lokasi-simpan',
        'layanan-fisik/arsip-vital-terjaga',
      ],
    },
    {
      type: 'category',
      label: '💾 Media & Autentikasi',
      items: [
        'media-autentikasi/arsip-elektronik',
        'media-autentikasi/autentikasi',
        'media-autentikasi/tunjuk-silang',
      ],
    },
    {
      type: 'category',
      label: '⚙️ Administrasi',
      items: [
        'administrasi/laporan',
        'administrasi/audit-log',
        'administrasi/persetujuan-akses',
        'administrasi/integrasi-srikandi',
        'administrasi/user-management',
        'administrasi/master-data',
        'administrasi/versi-aturan',
        'administrasi/settings',
      ],
    },
  ],
};

export default sidebars;
