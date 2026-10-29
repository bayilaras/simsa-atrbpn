import { getTableColumns } from 'drizzle-orm';
import { arsip, suratKeluar, suratMasuk } from '../../db/schema/index.js';

/**
 * Registri kolom rekaman surat dan arsip. Setiap kolom WAJIB punya kategori;
 * kolom skema baru tanpa entri menggagalkan tsc (`satisfies`) dan
 * kolom-rekaman.registry.test.ts.
 *
 * - 'kendali': id, unit, kelas, status, dan rujukan antarrekaman.
 * - 'metadata': uraian rekaman yang tampil di daftar menurut kebijakan list.
 * - 'isi': isi berkas atau penunjuknya (teks OCR, tautan dokumen, nama dan
 *   lokasi berkas). Hanya untuk respons per rekaman yang lolos pemeriksaan
 *   akses; proyeksi daftar dibentuk dengan proyeksiTanpaIsi.
 */
export type KategoriKolom = 'kendali' | 'metadata' | 'isi';

type Registri<T extends { $inferSelect: object }> = Record<keyof T['$inferSelect'], KategoriKolom>;

export const KOLOM_ARSIP = {
    id: 'kendali',
    unitKerjaId: 'kendali',
    jenisArsip: 'metadata',
    mediaType: 'metadata',
    sourceSuratId: 'kendali',
    tahun: 'metadata',
    nomorBerkas: 'metadata',
    kodeKlasifikasi: 'metadata',
    klasifikasiArsipId: 'kendali',
    klasifikasiRuleSetId: 'kendali',
    klasifikasiVersion: 'metadata',
    klasifikasiReference: 'metadata',
    klasifikasiSnapshotHash: 'metadata',
    uraianBerkas: 'metadata',
    nomorItem: 'metadata',
    uraianItem: 'metadata',
    tingkatPerkembangan: 'metadata',
    tanggalArsip: 'metadata',
    kurunWaktu: 'metadata',
    jumlah: 'metadata',
    lokasiFc: 'metadata',
    lokasiLaci: 'metadata',
    lokasiFolder: 'metadata',
    masaSimpanAktif: 'metadata',
    masaSimpanInaktif: 'metadata',
    hasilAkhir: 'metadata',
    klasifikasiKeamanan: 'kendali',
    personInCharge: 'metadata',
    unitPengolah: 'metadata',
    keterangan: 'metadata',
    jraKode: 'metadata',
    jraItemId: 'kendali',
    jraRuleSetId: 'kendali',
    jraUraian: 'metadata',
    retensiAktif: 'metadata',
    retensiInaktif: 'metadata',
    retensiKeterangan: 'metadata',
    retentionTriggerType: 'metadata',
    retentionTriggerLabel: 'metadata',
    retentionTriggerDate: 'metadata',
    retentionTriggerEvidence: 'metadata',
    currentRetentionTriggerEventId: 'kendali',
    jraVersion: 'metadata',
    jraReference: 'metadata',
    retentionDecisionHash: 'metadata',
    currentRuleSnapshotId: 'kendali',
    currentAppraisalDecisionId: 'kendali',
    ruleProvenanceStatus: 'kendali',
    nomorSuratOriginal: 'metadata',
    tanggalSuratOriginal: 'metadata',
    perihalOriginal: 'metadata',
    tanggalKadaluarsa: 'metadata',
    storageLocationId: 'kendali',
    lendingStatus: 'kendali',
    extractedText: 'isi',
    ocrStatus: 'kendali',
    ocrProcessedAt: 'kendali',
    disposalStatus: 'kendali',
    disposalBatchId: 'kendali',
    inactiveTransferredAt: 'kendali',
    inactiveTransferBatchId: 'kendali',
    legalHold: 'kendali',
    legalHoldReason: 'metadata',
    legalHoldPlacedAt: 'kendali',
    legalHoldPlacedBy: 'kendali',
    legalHoldReleasedAt: 'kendali',
    legalHoldReleasedBy: 'kendali',
    legalHoldReleaseReason: 'metadata',
    createdBy: 'kendali',
    createdAt: 'kendali',
    updatedAt: 'kendali',
} as const satisfies Registri<typeof arsip>;

export const KOLOM_SURAT_MASUK = {
    id: 'kendali',
    unitKerjaId: 'kendali',
    noUrut: 'kendali',
    tahun: 'kendali',
    jenisSurat: 'metadata',
    // Pada surat masuk, sifat_surat memuat kelas keamanan.
    sifatSurat: 'kendali',
    nomorSurat: 'metadata',
    tanggalSurat: 'metadata',
    perihal: 'metadata',
    dari: 'metadata',
    kepada: 'metadata',
    status: 'kendali',
    disposisi: 'metadata',
    keterangan: 'metadata',
    linkDokumen: 'isi',
    filePath: 'isi',
    fileOriginalName: 'isi',
    klasifikasiItemId: 'kendali',
    jraItemId: 'kendali',
    klasifikasiKode: 'metadata',
    klasifikasiUraian: 'metadata',
    isArchived: 'kendali',
    isDeleted: 'kendali',
    deletedAt: 'kendali',
    deletedBy: 'kendali',
    createdBy: 'kendali',
    createdAt: 'kendali',
    updatedAt: 'kendali',
} as const satisfies Registri<typeof suratMasuk>;

export const KOLOM_SURAT_KELUAR = {
    id: 'kendali',
    unitKerjaId: 'kendali',
    noUrut: 'kendali',
    tahun: 'kendali',
    naskahDinas: 'metadata',
    // Pada surat keluar, sifat_surat memuat urgensi; kelasnya klasifikasi_keamanan.
    sifatSurat: 'metadata',
    nomorSurat: 'metadata',
    tanggalSurat: 'metadata',
    perihal: 'metadata',
    kepada: 'metadata',
    linkDokumen: 'isi',
    balasanUntuk: 'kendali',
    asalNaskah: 'kendali',
    klasifikasiItemId: 'kendali',
    jraItemId: 'kendali',
    klasifikasiFasilitatifKode: 'metadata',
    klasifikasiFasilitatif: 'metadata',
    klasifikasiSubstantifKode: 'metadata',
    klasifikasiSubstantif: 'metadata',
    klasifikasiKeamanan: 'kendali',
    filePath: 'isi',
    fileOriginalName: 'isi',
    isArchived: 'kendali',
    isDeleted: 'kendali',
    deletedAt: 'kendali',
    deletedBy: 'kendali',
    approvalStatus: 'kendali',
    currentApproverId: 'kendali',
    isSigned: 'kendali',
    signedAt: 'kendali',
    createdBy: 'kendali',
    createdAt: 'kendali',
    updatedAt: 'kendali',
} as const satisfies Registri<typeof suratKeluar>;

type KolomIsi<R> = { [K in keyof R]: R[K] extends 'isi' ? K : never }[keyof R];

/**
 * Proyeksi daftar: semua kolom berkategori selain 'isi'. Kolom tanpa entri
 * registri ikut dibuang (default-deny).
 */
export function proyeksiTanpaIsi<C extends Record<string, unknown>, R extends Record<string, KategoriKolom>>(
    columns: C,
    registri: R,
): Omit<C, KolomIsi<R>> {
    return Object.fromEntries(Object.entries(columns).filter(([key]) => {
        const kategori: KategoriKolom | undefined = registri[key];
        return kategori !== undefined && kategori !== 'isi';
    })) as Omit<C, KolomIsi<R>>;
}

export const ARSIP_KOLOM_DAFTAR = proyeksiTanpaIsi(getTableColumns(arsip), KOLOM_ARSIP);
