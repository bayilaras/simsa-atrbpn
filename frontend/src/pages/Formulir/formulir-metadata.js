// Tombol hanya untuk formulir yang benar-benar dibuat dari data aplikasi di
// halaman tujuannya; formulir lain diisi manual dari template kosong. Modul
// Penyusutan dan Arsip Terjaga (advancedArchiveWorkflows) mati di produksi,
// jadi tidak dirujuk.
const moduleFor = (id) => {
    // Formulir 4 dan 6 berisi data hanya lewat menu Export di halaman Arsip;
    // ekspor Laporan tidak dipisah per fase arsip.
    if (id === 4 || id === 6) return { path: '/arsip', label: 'Ekspor dari Arsip' };
    // Tombol Cetak Daftar di halaman Arsip Vital.
    if (id === 27) return { path: '/arsip-vital', label: 'Buka Arsip Vital' };
    return {};
};

const names = [
    'Berita Acara Peminjaman Arsip Asli Tanpa Pendampingan',
    'Berita Acara Pengembalian Arsip Asli Tanpa Pendampingan',
    'Surat Pernyataan Menghilangkan/Merusak Arsip',
    'Daftar Arsip Aktif',
    'Daftar Informasi Tematik',
    'Daftar Arsip Inaktif (Kertas)',
    'Daftar Arsip Inaktif (Foto)',
    'Daftar Arsip Inaktif (Sound Recording)',
    'Daftar Arsip Inaktif Video dan Film (Moving Image)',
    'Survei Arsip Inaktif',
    'Daftar Ikhtisar Arsip',
    'Berita Acara Alih Media Arsip',
    'Berita Acara Pemindahan Arsip',
    'Surat Keputusan Pembentukan Panitia Penilai Penyusutan Arsip',
    'Daftar Arsip Usul Musnah',
    'Undangan Rapat Pembahasan Pemusnahan Arsip',
    'Notula Rapat Panitia Penilai Penyusutan Arsip',
    'Pertimbangan Panitia Penilai Penyusutan Arsip',
    'Surat Keputusan Penetapan Pemusnahan Arsip',
    'Berita Acara Pemusnahan Arsip',
    'Daftar Arsip Usul Serah',
    'Daftar Arsip Statis yang akan Diserahkan',
    'Pertimbangan Panitia Penyusutan Arsip',
    'Surat Permohonan Penyerahan Arsip Statis',
    'Surat Keputusan Penetapan Penyerahan Arsip Statis',
    'Undangan untuk Menandatangani Berita Acara Penyerahan Arsip Statis',
    'Daftar Arsip Vital',
    'Kartu Tunjuk Silang',
    'Formulir Pendataan Arsip Terjaga',
    'Daftar Identifikasi Arsip Terjaga',
    'Daftar Berkas Arsip Terjaga',
    'Daftar Isi Berkas Arsip Terjaga',
    'Berita Acara Penyerahan Salinan Autentik Arsip Terjaga',
];

export const formulirMetadata = names.map((name, index) => {
    const id = index + 1;
    return { id, name: `Formulir ${id}: ${name}`, ...moduleFor(id) };
});

export function getFormulirMetadata(id) {
    return formulirMetadata.find((form) => form.id === Number(id));
}

export const KETERANGAN_DIISI_MANUAL = 'Diisi manual dari template';
