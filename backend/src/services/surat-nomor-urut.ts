import { and, desc, eq, type SQL } from 'drizzle-orm';
import { suratKeluar, suratMasuk } from '../db/schema';
import { ConflictError, ValidationError } from '../utils/errors.js';
import { resolveSuratCalendar } from '../utils/surat-numbering.js';
import { settingsService, type SuratTemplate } from './settings.service.js';

/**
 * Nomor urut (No. Agenda surat masuk, No. Urut surat keluar) per unit dan
 * tahun. Semua penentuan nomor berjalan di bawah kunci baris templat unit
 * (settingsService.lockSuratTemplates), mutex yang sama dengan max+1. Indeks
 * unik (unit, tahun, no_urut) mencakup surat yang sudah dihapus, jadi nomor
 * surat terhapus juga dihitung terpakai.
 */
export type JenisNomorUrut = 'masuk' | 'keluar';

/** Batas atas nomor yang diketik di formulir atau dibaca dari sumber impor. */
export const NOMOR_URUT_MAKS = 999_999;

export const LABEL_NOMOR_URUT: Record<JenisNomorUrut, string> = { masuk: 'No. Agenda', keluar: 'No. Urut' };
const NAMA_NOMOR_SUMBER: Record<JenisNomorUrut, string> = { masuk: 'Nomor agenda', keluar: 'Nomor urut' };
const TABEL = { masuk: suratMasuk, keluar: suratKeluar } as const;
const PANJANG_GEMA_SUMBER = 20;

export function nomorUrutSah(nilai: unknown): nilai is number {
    return Number.isSafeInteger(nilai) && (nilai as number) >= 1 && (nilai as number) <= NOMOR_URUT_MAKS;
}

/** Nomor dari sel sumber impor: angka bulat 1 sampai 999999 (nol di depan boleh); selain itu null. */
export function nomorUrutSumber(nilai: string | null | undefined): number | null {
    const teks = (nilai ?? '').trim();
    if (!/^\d{1,12}$/.test(teks)) return null;
    const angka = Number(teks);
    return nomorUrutSah(angka) ? angka : null;
}

/** Nomor tertinggi + 1 di unit dan tahun itu. Panggil di bawah kunci templat unit. */
export async function nomorUrutBerikutnya(
    executor: any,
    jenis: JenisNomorUrut,
    unitKerjaId: string,
    tahun: number,
    { kunciBarisTerakhir = false }: { kunciBarisTerakhir?: boolean } = {},
): Promise<number> {
    const tabel = TABEL[jenis];
    const kueri = executor
        .select({ noUrut: tabel.noUrut })
        .from(tabel)
        .where(and(eq(tabel.unitKerjaId, unitKerjaId), eq(tabel.tahun, tahun)))
        .orderBy(desc(tabel.noUrut))
        .limit(1);
    const [terakhir] = kunciBarisTerakhir ? await kueri.for('update') : await kueri;
    return (terakhir?.noUrut || 0) + 1;
}

export async function nomorUrutTerpakai(
    executor: any,
    jenis: JenisNomorUrut,
    unitKerjaId: string,
    tahun: number,
    noUrut: number,
): Promise<boolean> {
    const tabel = TABEL[jenis];
    const [ada] = await executor
        .select({ id: tabel.id })
        .from(tabel)
        .where(and(eq(tabel.unitKerjaId, unitKerjaId), eq(tabel.tahun, tahun), eq(tabel.noUrut, noUrut)))
        .limit(1);
    return Boolean(ada);
}

export function pesanNomorUrutTerpakai(jenis: JenisNomorUrut, noUrut: number, tahun: number): string {
    const label = LABEL_NOMOR_URUT[jenis];
    return `${label} ${noUrut} tahun ${tahun} sudah dipakai surat lain di unit ini. `
        + `${label} milik surat yang sudah dihapus juga tidak dapat dipakai ulang. Kosongkan ${label} untuk nomor otomatis atau isi nomor lain.`;
}

/**
 * Nomor urut surat baru, di bawah kunci templat unit. Nomor yang diminta
 * dipakai bila belum terpakai. Bila terpakai, formulir mendapat 409 yang
 * menyebut nomornya, sedangkan impor (`lanjutBilaTerpakai`) mendapat nomor
 * berikutnya. Tanpa permintaan, aturan lama berlaku: tertinggi + 1.
 */
export async function tentukanNomorUrut(
    executor: any,
    jenis: JenisNomorUrut,
    unitKerjaId: string,
    tahun: number,
    diminta: number | null | undefined,
    { lanjutBilaTerpakai }: { lanjutBilaTerpakai: boolean },
): Promise<number> {
    if (diminta !== undefined && diminta !== null) {
        if (!nomorUrutSah(diminta)) {
            if (!lanjutBilaTerpakai) {
                throw new ValidationError(`${LABEL_NOMOR_URUT[jenis]} harus berupa angka 1 sampai ${NOMOR_URUT_MAKS}.`);
            }
        } else if (!(await nomorUrutTerpakai(executor, jenis, unitKerjaId, tahun, diminta))) {
            return diminta;
        } else if (!lanjutBilaTerpakai) {
            throw new ConflictError(pesanNomorUrutTerpakai(jenis, diminta, tahun));
        }
    }
    return nomorUrutBerikutnya(executor, jenis, unitKerjaId, tahun, { kunciBarisTerakhir: true });
}

/**
 * Keterangan baris impor bila nomor dari sumber tidak dapat disimpan apa
 * adanya; undefined bila sumber tidak bernomor atau nomornya tersimpan.
 */
export function catatanNomorUrutImpor(jenis: JenisNomorUrut, sumber: string | null | undefined, tersimpan: unknown): string | undefined {
    const teks = (sumber ?? '').trim();
    if (!teks || typeof tersimpan !== 'number') return undefined;
    const diminta = nomorUrutSumber(teks);
    if (diminta === tersimpan) return undefined;
    const nama = NAMA_NOMOR_SUMBER[jenis];
    if (diminta === null) {
        const gema = teks.length > PANJANG_GEMA_SUMBER ? `${teks.slice(0, PANJANG_GEMA_SUMBER - 1)}…` : teks;
        return `${nama} sumber "${gema}" bukan angka 1 sampai ${NOMOR_URUT_MAKS}; diberi nomor ${tersimpan}.`;
    }
    return `${nama} sumber ${diminta} sudah dipakai; diberi nomor ${tersimpan}.`;
}

type BarisBernomor = {
    unitKerjaId: string;
    tahun: number;
    noUrut: number;
    tanggalSurat: string | null;
    nomorSurat: string | null;
    /** Surat keluar saja; template nomornya dapat memuat {naskahDinas}. */
    naskahDinas?: string | null;
};

/** Rentang tahun yang sama dengan isian tahun saat mencatat surat. */
export const TAHUN_URUTAN_MIN = 2000;
export const TAHUN_URUTAN_MAKS = 2100;
export const PESAN_TAHUN_DI_LUAR_RENTANG = 'Tahun harus antara 2000 dan 2100';

/**
 * Tahun urutan baru bila tanggal surat diubah ke tahun lain dari kolom tahun;
 * null bila tanggal tidak berubah atau tetap di tahun yang sama. Pindah ke
 * tahun di luar 2000-2100 ditolak seperti saat mencatat surat.
 */
export function tahunUrutanBaru(
    sekarang: Pick<BarisBernomor, 'tahun' | 'tanggalSurat'>,
    tanggalBaru: string | null | undefined,
): number | null {
    if (!tanggalBaru || tanggalBaru === sekarang.tanggalSurat) return null;
    const { tahun } = resolveSuratCalendar({ tanggalSurat: tanggalBaru });
    if (tahun === sekarang.tahun) return null;
    if (tahun < TAHUN_URUTAN_MIN || tahun > TAHUN_URUTAN_MAKS) throw new ValidationError(PESAN_TAHUN_DI_LUAR_RENTANG);
    return tahun;
}

/**
 * Langkah pertama transaksi ubah: bila tanggal baru membawa surat ke tahun
 * lain, kunci templat unit sebelum baris surat, urutan kunci yang sama dengan
 * pembuatan surat (templat, lalu baris surat). Dibaca tanpa kunci; keputusan
 * akhirnya diambil lagi di bawah kunci baris (pindahUrutanTahun). Hasilnya
 * templat yang terkunci, atau null.
 */
export async function kunciTemplatBilaPindahTahun(
    executor: any,
    jenis: JenisNomorUrut,
    where: SQL,
    tanggalBaru: string | null | undefined,
): Promise<SuratTemplate | null> {
    if (!tanggalBaru) return null;
    const tabel = TABEL[jenis];
    const [sekarang] = await executor
        .select({ unitKerjaId: tabel.unitKerjaId, tahun: tabel.tahun, tanggalSurat: tabel.tanggalSurat })
        .from(tabel)
        .where(where)
        .limit(1);
    if (!sekarang || tahunUrutanBaru(sekarang, tanggalBaru) === null) return null;
    return settingsService.lockSuratTemplates(executor, sekarang.unitKerjaId);
}

/** Alasan koreksi rangkaian bila nomor surat hanya berubah karena dibuat ulang saat pindah tahun. */
export const ALASAN_NOMOR_PINDAH_TAHUN = 'Nomor surat otomatis dibuat ulang karena tahun surat berubah.';

export interface PindahUrutan {
    /** nomorSurat hanya ada bila nomor surat otomatis ikut dibuat ulang. */
    sebelum: { tahun: number; noUrut: number; nomorSurat?: string | null };
    sesudah: { tahun: number; noUrut: number; nomorSurat?: string };
}

const bulanDari = (tanggal: string | null | undefined) => tanggal ? resolveSuratCalendar({ tanggalSurat: tanggal }).bulan : null;

/** Nomor dari template unit seperti saat surat dicatat; null bila template tidak menghasilkan nomor. */
function nomorDariTemplat(format: string, data: { noUrut: number; tahun: number; bulan: number; unitKerja: string; naskahDinas?: string | null }) {
    try {
        return settingsService.generateSuratNumber(format, { ...data, naskahDinas: data.naskahDinas || undefined });
    } catch {
        return null;
    }
}

/**
 * Surat yang tanggalnya pindah tahun mendapat nomor berikutnya di tahun baru,
 * di bawah kunci templat yang sama dengan pembuatan surat. Nomor surat yang
 * sama persis dengan hasil template untuk tahun, nomor, dan bulan lama dibuat
 * otomatis, jadi ikut dibuat ulang untuk tahun dan nomor baru; tanpa itu surat
 * yang dicatat kemudian di tahun lama mendapat nomor surat yang sama. Nomor
 * yang diketik staf (berbeda dari hasil template) atau diubah pada suntingan
 * ini tidak disentuh. `sekarang` adalah baris yang sudah dikunci.
 */
export async function pindahUrutanTahun(
    executor: any,
    jenis: JenisNomorUrut,
    sekarang: BarisBernomor,
    perubahan: { tanggalSurat?: string | null; nomorSurat?: string | null; naskahDinas?: string | null },
    templatTerkunci: SuratTemplate | null,
): Promise<PindahUrutan | null> {
    const tahun = tahunUrutanBaru(sekarang, perubahan.tanggalSurat);
    if (tahun === null) return null;
    // Templat dikunci di sini hanya bila tahun berubah di antara pembacaan awal dan kunci baris.
    const templat = templatTerkunci ?? await settingsService.lockSuratTemplates(executor, sekarang.unitKerjaId);
    const noUrut = await nomorUrutBerikutnya(executor, jenis, sekarang.unitKerjaId, tahun);
    const pindah: PindahUrutan = { sebelum: { tahun: sekarang.tahun, noUrut: sekarang.noUrut }, sesudah: { tahun, noUrut } };

    const nomorDikirim = perubahan.nomorSurat?.trim();
    const bulanLama = bulanDari(sekarang.tanggalSurat);
    if (!sekarang.nomorSurat || bulanLama === null || (nomorDikirim && nomorDikirim !== sekarang.nomorSurat)) return pindah;
    const format = jenis === 'masuk' ? templat.masukFormat : templat.keluarFormat;
    // Surat masuk dicatat tanpa {naskahDinas}; surat keluar dengan naskah dinasnya.
    const naskahLama = jenis === 'keluar' ? sekarang.naskahDinas : undefined;
    const naskahBaru = jenis === 'keluar' ? (perubahan.naskahDinas ?? sekarang.naskahDinas) : undefined;
    const otomatisLama = nomorDariTemplat(format, {
        noUrut: sekarang.noUrut, tahun: sekarang.tahun, bulan: bulanLama, unitKerja: sekarang.unitKerjaId, naskahDinas: naskahLama,
    });
    if (otomatisLama !== sekarang.nomorSurat) return pindah;
    const otomatisBaru = nomorDariTemplat(format, {
        noUrut, tahun, bulan: bulanDari(perubahan.tanggalSurat)!, unitKerja: sekarang.unitKerjaId, naskahDinas: naskahBaru,
    });
    if (!otomatisBaru) return pindah;
    pindah.sebelum.nomorSurat = sekarang.nomorSurat;
    pindah.sesudah.nomorSurat = otomatisBaru;
    return pindah;
}
