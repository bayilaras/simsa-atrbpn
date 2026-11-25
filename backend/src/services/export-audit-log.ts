import { auditLogService, type AuditLogFilters } from './audit-log.service';
import { EXPORT_ROW_LIMIT, requireCompleteExport } from './export-completeness.js';
import { waktuWib } from '../utils/jakarta-date.js';
import type { SelTabel, TabelEkspor } from './export-tabel.js';

/**
 * Ekspor Audit Log (Excel). Barisnya diambil lewat auditLogService.listLogs,
 * kueri yang sama dengan halaman Audit Log. Isi kolom `changes` tidak ikut
 * diekspor karena dapat memuat isi surat; yang ditulis hanya ringkasan berupa
 * nama isian yang berubah, tanpa nilainya.
 */

// Cermin ACTION_CONFIG di frontend/src/pages/AuditLog.jsx.
const LABEL_AKSI: Record<string, string> = {
    create: 'Membuat',
    update: 'Mengubah',
    delete: 'Menghapus',
    archive: 'Mengarsipkan',
    restore: 'Memulihkan',
    status_change: 'Ubah Status',
    request_access: 'Meminta Akses',
    approve_access: 'Menyetujui Akses',
    deny_access: 'Menolak Akses',
    revoke_access: 'Mencabut Akses',
    view_via_rangkaian: 'Lihat via Rangkaian',
    export: 'Ekspor Data',
    merge: 'Menggabungkan',
    link: 'Menautkan',
    cancel: 'Membatalkan',
    distribute: 'Mendisposisikan',
    receive_distribution: 'Menerima Disposisi',
    process_distribution: 'Menyelesaikan Disposisi',
    reject_distribution: 'Menolak Disposisi',
    run_scanner: 'Menjalankan Pemindai',
    sign_in: 'Masuk',
    sign_in_failed: 'Gagal masuk',
    sign_out: 'Keluar',
    view: 'Melihat',
    download: 'Mengunduh',
    verify_integrity: 'Memeriksa Integritas',
    hold: 'Menerapkan Legal Hold',
    release_hold: 'Melepas Legal Hold',
    change_password: 'Mengganti kata sandi',
};

// Cermin ENTITY_CONFIG di frontend/src/pages/AuditLog.jsx.
const LABEL_ENTITAS: Record<string, string> = {
    surat_masuk: 'Surat Masuk',
    surat_keluar: 'Surat Keluar',
    arsip: 'Arsip',
    user: 'User',
    record_access_grant: 'Persetujuan Akses',
    rangkaian_surat: 'Rangkaian Surat',
    rangkaian_relasi: 'Relasi Rangkaian',
    surat_distribution: 'Disposisi',
    file_attachment: 'Berkas',
    archive_lending: 'Peminjaman Arsip',
    audit_log: 'Audit Log',
};

const MAKS_NAMA_ISIAN = 12;
const namaIsian = (nilai: unknown): nilai is string => typeof nilai === 'string' && nilai.length > 0 && nilai.length <= 60;
const teksPendek = (nilai: unknown): string | null =>
    typeof nilai === 'string' && /^[\w-]{1,30}$/.test(nilai) ? nilai : null;

/**
 * Ringkasan satu baris audit: nama isian yang berubah (seperti judul baris
 * pada Detail Perubahan di layar) dan, untuk ekspor, sumber serta formatnya.
 * Nilai sebelum/sesudah tidak pernah ditulis.
 */
export function ringkasanPerubahan(changes: unknown): string {
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return '';
    const isi = changes as Record<string, unknown>;
    const bagian: string[] = [];

    const kunci = (nilai: unknown) => (nilai && typeof nilai === 'object' && !Array.isArray(nilai) ? Object.keys(nilai) : []);
    const isian = (Array.isArray(isi.fields) ? isi.fields : [...new Set([...kunci(isi.before), ...kunci(isi.after)])])
        .filter(namaIsian);
    if (isian.length > 0) {
        const tampil = isian.slice(0, MAKS_NAMA_ISIAN).join(', ');
        const sisa = isian.length - MAKS_NAMA_ISIAN;
        bagian.push(`Isian: ${tampil}${sisa > 0 ? `, dan ${sisa} lainnya` : ''}`);
    }
    if (Array.isArray(isi.items) && isi.items.length > 0) bagian.push(`${isi.items.length} item arsip ikut diubah`);

    const sumber = teksPendek(isi.source);
    const format = teksPendek(isi.format);
    if (sumber) bagian.push(`Sumber: ${sumber}`);
    if (format) bagian.push(`Format: ${format}`);
    return bagian.join('; ');
}

export interface BarisAuditLog {
    userName?: string | null;
    userEmail?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    changes?: unknown;
    ipAddress?: string | null;
    createdAt: Date | string | null;
}

export function selAuditLog(baris: BarisAuditLog, nomor: number): SelTabel[] {
    return [
        nomor,
        waktuWib(baris.createdAt),
        // Sama dengan nama pelaku di layar.
        baris.userName || baris.userEmail || (baris.action === 'sign_in_failed' ? 'Pengguna tidak dikenal' : 'System'),
        baris.userEmail || '-',
        LABEL_AKSI[baris.action] ?? baris.action,
        LABEL_ENTITAS[baris.entityType] ?? baris.entityType,
        baris.entityId || '-',
        baris.ipAddress || '-',
        ringkasanPerubahan(baris.changes) || '-',
    ];
}

/** Penyaring yang sama dengan daftar Audit Log, tanpa halaman. */
export type SaringanEksporAuditLog = Omit<AuditLogFilters, 'page' | 'limit'>;

/** Tulisan penyaring di bawah judul, dengan label yang sama dengan pilihan di layar. */
export function keteranganAuditLog(saringan: SaringanEksporAuditLog, rentang: { dari?: string; sampai?: string }): string {
    return [
        `Rentang: ${rentang.dari || 'awal'} s.d. ${rentang.sampai || waktuWib(saringan.endDate ?? new Date())}`,
        ...(saringan.entityType ? [`Jenis data: ${LABEL_ENTITAS[saringan.entityType] ?? saringan.entityType}`] : []),
        ...(saringan.action ? [`Aksi: ${LABEL_AKSI[saringan.action] ?? saringan.action}`] : []),
        ...(saringan.search ? [`Pencarian: ${saringan.search}`] : []),
    ].join(' | ');
}

export const eksporAuditLogService = {
    async tabel(saringan: SaringanEksporAuditLog, rentang: { dari?: string; sampai?: string } = {}): Promise<TabelEkspor> {
        const hasil = await auditLogService.listLogs({ ...saringan, page: 1, limit: EXPORT_ROW_LIMIT });
        const data = requireCompleteExport<BarisAuditLog>(hasil);
        return {
            lembar: 'Audit Log',
            judul: 'AUDIT LOG',
            keterangan: [keteranganAuditLog(saringan, rentang)],
            kolom: [
                { judul: 'No', lebarExcel: 6, lebarPdf: 25 },
                { judul: 'Waktu', lebarExcel: 24, lebarPdf: 80 },
                { judul: 'Pengguna', lebarExcel: 26, lebarPdf: 90, rataKiri: true },
                { judul: 'Email', lebarExcel: 30, lebarPdf: 100, rataKiri: true },
                { judul: 'Aksi', lebarExcel: 22, lebarPdf: 70 },
                { judul: 'Jenis Data', lebarExcel: 20, lebarPdf: 70 },
                { judul: 'ID Data', lebarExcel: 38, lebarPdf: 110 },
                { judul: 'Alamat IP', lebarExcel: 18, lebarPdf: 60 },
                { judul: 'Ringkasan', lebarExcel: 50, lebarPdf: 177, rataKiri: true },
            ],
            kolomLentur: 8,
            baris: data.map((baris, indeks) => selAuditLog(baris, indeks + 1)),
            total: `Total: ${data.length} log`,
        };
    },
};
