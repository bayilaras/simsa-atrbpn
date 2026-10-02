// Bentuk ini dibekukan untuk P4 (rencana P4 Task 1). Jangan ubah nama bidang.
export type LacakMode = 'lacak' | 'referensi' | 'cek';
export type LacakSuratJenis = 'surat_masuk' | 'surat_keluar';
export type LacakJenisRelasi = 'balasan' | 'tindak_lanjut' | 'menjelaskan' | 'merujuk';

export interface LacakParams {
    q: string;
    mode: LacakMode;
    limit?: number;
    tahun?: number;
    jenis?: LacakSuratJenis;
}

export interface LacakNode {
    anggotaId: string | null;
    jenis: LacakSuratJenis;
    id: string;
    nomorSurat: string | null;
    perihal: string | null;
    tanggalSurat: string | null;
    tahun: number;
    naskah: string | null;
    unitKerjaId: string;
    unitNama: string;
    relasi: LacakJenisRelasi | null;
    masked: false;
}

export interface LacakNodeTersamar {
    anggotaId: string;
    jenis: LacakSuratJenis;
    unitNama: string;
    label: 'Dikecualikan';
    masked: true;
    dapatAjukanAkses: boolean;
}

export interface LacakCocok {
    jenis: LacakSuratJenis;
    id: string;
    nomorSurat: string | null;
    perihal: string | null;
    tahun: number;
    skor: number;
}

export interface LacakKelompok {
    kunci: string;
    skor: number;
    tanggalTerbaru: string | null;
    rangkaian: { id: string; kode: string; status: 'aktif' | 'selesai' | 'diberkaskan' | 'digabung'; judul: string; tahun: number; asal: string } | null;
    cocok: LacakCocok[];
    pratinjau: Array<LacakNode | LacakNodeTersamar>;
    jumlahAnggota: number;
    pratinjauTerpotong: boolean;
}

export interface LacakResult {
    q: string;
    mode: LacakMode;
    jenisKueri: 'nomor' | 'perihal';
    kelompok: LacakKelompok[];
}
