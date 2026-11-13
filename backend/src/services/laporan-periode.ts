/**
 * Periode halaman Laporan: satu sumber aturan untuk tabel dan ekspornya.
 *
 * Tabel laporan surat memakai rentang tanggal bila salah satu tanggal diisi,
 * dan baru memakai tahun bila kedua tanggal kosong. Ekspor Laporan wajib
 * memakai fungsi yang sama supaya isi berkas sama dengan tabel di layar.
 */
export interface PilihanPeriodeLaporan {
    year?: number;
    tanggalDari?: string | null;
    tanggalSampai?: string | null;
}

export interface PeriodeLaporanSurat {
    tahun?: number;
    tanggalDari?: string;
    tanggalSampai?: string;
}

export function periodeLaporanSurat(pilihan: PilihanPeriodeLaporan): PeriodeLaporanSurat {
    const tanggalDari = pilihan.tanggalDari || undefined;
    const tanggalSampai = pilihan.tanggalSampai || undefined;
    return {
        tahun: pilihan.year && !tanggalDari && !tanggalSampai ? pilihan.year : undefined,
        tanggalDari,
        tanggalSampai,
    };
}

/** Laporan arsip hanya mengenal tahun; isian tanggal tidak dipakai tabelnya. */
export function periodeLaporanArsip(pilihan: PilihanPeriodeLaporan): { tahun?: number } {
    return { tahun: pilihan.year || undefined };
}

function tanggalCetak(tanggal: string): string {
    const cocok = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tanggal);
    return cocok ? `${cocok[3]}-${cocok[2]}-${cocok[1]}` : tanggal;
}

/** Tulisan periode pada judul berkas ekspor; kosong bila laporan memakai tahun. */
export function keteranganPeriodeLaporan(periode: PeriodeLaporanSurat): string | undefined {
    const { tanggalDari, tanggalSampai } = periode;
    if (tanggalDari && tanggalSampai) return `Periode ${tanggalCetak(tanggalDari)} s.d. ${tanggalCetak(tanggalSampai)}`;
    if (tanggalDari) return `Periode mulai ${tanggalCetak(tanggalDari)}`;
    if (tanggalSampai) return `Periode sampai ${tanggalCetak(tanggalSampai)}`;
    return undefined;
}
