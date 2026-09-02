const moduleFor = (id) => {
    if (id <= 3) return { path: '/archive-lending', label: 'Buka Peminjaman' };
    if (id <= 11) return { path: '/laporan', label: 'Buka Laporan' };
    if (id <= 26) return { path: '/penyusutan', label: 'Buka Penyusutan' };
    if (id === 27) return { path: '/arsip-vital', label: 'Buka Arsip Vital' };
    if (id === 28) return { path: '/tunjuk-silang', label: 'Buka Tunjuk Silang' };
    return { path: '/arsip-terjaga', label: 'Buka Arsip Terjaga' };
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
