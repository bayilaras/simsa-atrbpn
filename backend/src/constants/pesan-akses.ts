// Teks `error` 403 ini diteruskan apa adanya ke formulir (services/api.js di
// frontend), jadi sebutkan siapa yang berwenang, bukan hanya penolakannya.
export const PESAN_KELAS_MELEBIHI_KEWENANGAN =
    'Klasifikasi keamanan melebihi kewenangan pengguna. Kelas Rahasia dan Sangat Rahasia hanya dapat ditetapkan oleh Super Admin.';

export const PESAN_LOKASI_SIMPAN_TIDAK_SESUAI =
    'Lokasi simpan tidak ditemukan atau bukan milik unit kerja arsip ini. Pilih lokasi simpan lain.';

export const PESAN_LOKASI_ARSIP_SEDANG_DIPINJAM =
    'Lokasi simpan tidak dapat diubah karena arsip atau boksnya sedang dipinjam. Catat pengembaliannya terlebih dahulu.';

export const PESAN_BOKS_TUJUAN_SEDANG_DIPINJAM =
    'Boks yang dipilih sedang dipinjam. Pilih lokasi simpan lain atau catat pengembalian boks terlebih dahulu.';

// Sifat surat masuk sekaligus kelas keamanannya. Kata urgensi yang disebut di
// sini dibaca Biasa (BIASA_SIFAT_ALIASES di services/access/visibility-spec.ts).
export const PESAN_SIFAT_TIDAK_DIKENAL =
    'Sifat surat tidak dikenal. Gunakan Biasa, Terbatas, Rahasia, atau Sangat Rahasia, atau sifat urgensi Segera, Sangat Segera, Amat Segera/Kilat, Penting, atau Undangan.';

// Jawaban 403 detail rekaman berkelas terkendali yang sudah tampil di daftar
// pengguna tetapi belum punya persetujuan akses.
export const PESAN_PERLU_PERSETUJUAN_AKSES =
    'Rekaman ini berkelas keamanan terkendali dan baru dapat dibuka setelah permohonan akses Anda disetujui Super Admin.';
