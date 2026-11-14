import { z } from 'zod';

/**
 * Pesan bawaan Zod dalam bahasa Indonesia untuk semua validator permintaan.
 * Pesan yang ditulis sendiri pada skema (mis. `.min(1, 'Perihal wajib diisi')`)
 * tetap didahulukan Zod; peta ini hanya mengisi aturan yang tidak diberi pesan.
 * Nama isian diambil dari LABEL_ISIAN; nama kode tidak pernah ditampilkan.
 */
export const LABEL_ISIAN: Readonly<Record<string, string>> = {
    accessMode: 'Mode akses',
    action: 'Tindakan',
    activeMonths: 'Masa aktif (bulan)',
    activityAt: 'Waktu kegiatan',
    alasan: 'Alasan',
    alasanPenetapan: 'Alasan penetapan',
    alatDigitalisasi: 'Alat digitalisasi',
    appraisalDecisionId: 'Keputusan penilaian',
    arsipId: 'Arsip',
    arsipIds: 'Daftar arsip',
    arsipItemId: 'Item arsip',
    asal: 'Asal',
    asalNaskah: 'Asal naskah',
    attachmentId: 'Lampiran',
    authorityAttachmentId: 'Lampiran kewenangan',
    balasanUntuk: 'Surat yang dibalas',
    basis: 'Dasar',
    batasWaktu: 'Batas waktu',
    beritaAcaraAttachmentId: 'Lampiran berita acara',
    blobUrl: 'Berkas unggahan',
    borrowerId: 'Peminjam',
    borrowerName: 'Nama peminjam',
    calculationMode: 'Cara perhitungan',
    capacity: 'Kapasitas',
    caseType: 'Jenis perkara',
    catatan: 'Catatan',
    catatanPenyelesaian: 'Catatan penyelesaian',
    ccUnits: 'Unit tembusan',
    changeSummary: 'Ringkasan perubahan',
    code: 'Kode',
    colorDepth: 'Kedalaman warna',
    copiesStatement: 'Pernyataan salinan',
    correctionReason: 'Alasan koreksi',
    correctsEventId: 'Peristiwa yang dikoreksi',
    counterparty: 'Pihak terkait',
    coveredPageRanges: 'Rentang halaman',
    dari: 'Pengirim',
    dasarHukum: 'Dasar hukum',
    decisionAttachmentId: 'Lampiran keputusan',
    departmentUnit: 'Unit peminjam',
    description: 'Deskripsi',
    deskripsi: 'Deskripsi',
    destination: 'Tujuan',
    details: 'Rincian',
    disposisi: 'Disposisi',
    disposisiUnitId: 'Unit disposisi',
    distribusiId: 'Disposisi',
    dispositionCode: 'Kode keputusan',
    documentSha256: 'Hash dokumen',
    documentUri: 'Alamat dokumen',
    dryRun: 'Mode uji',
    dueDate: 'Batas pengembalian',
    effectiveFrom: 'Tanggal berlaku',
    eligibleForAutentikasi: 'Layak autentikasi',
    email: 'Email',
    emailNotifications: 'Notifikasi email',
    end: 'Akhir',
    entityId: 'Data',
    entityType: 'Jenis data',
    eventAt: 'Waktu peristiwa',
    eventDate: 'Tanggal peristiwa',
    eventType: 'Jenis peristiwa',
    evidenceAttachmentId: 'Lampiran bukti',
    evidenceSha256: 'Hash bukti',
    evidenceUri: 'Alamat bukti',
    executionEvidence: 'Bukti pelaksanaan',
    executionProofAttachmentId: 'Lampiran bukti pelaksanaan',
    expectedCount: 'Jumlah dari pratinjau',
    expectedItemCount: 'Jumlah item dari pratinjau',
    expectedSelectableCount: 'Jumlah pilihan dari pratinjau',
    expectedUpdatedAt: 'Versi data',
    expiresAt: 'Waktu berakhir',
    expiring: 'Filter hampir jatuh tempo',
    fileAttachmentId: 'Lampiran',
    fileName: 'Nama berkas',
    fileOriginalName: 'Nama berkas',
    filePath: 'Berkas unggahan',
    formatFile: 'Format berkas',
    hasilAkhir: 'Hasil akhir',
    id: 'Data',
    image: 'Gambar',
    inactiveMonths: 'Masa inaktif (bulan)',
    instruction: 'Instruksi',
    instruksi: 'Instruksi',
    instrumentType: 'Jenis instrumen',
    isActive: 'Status aktif',
    isSelectable: 'Dapat dipilih',
    itemArsipIds: 'Daftar arsip',
    itemDecisions: 'Keputusan per item',
    itemId: 'Item',
    items: 'Daftar item',
    jabatan: 'Jabatan',
    jabatanPenandaTangan: 'Jabatan penanda tangan',
    jadwalBackup: 'Jadwal cadangan',
    jenis: 'Jenis',
    jenisArsip: 'Jenis arsip',
    jenisLayanan: 'Jenis layanan',
    jenisPenyusutan: 'Jenis penyusutan',
    jenisRelasi: 'Jenis hubungan',
    jenisSurat: 'Jenis surat',
    jraItemId: 'Jadwal Retensi Arsip',
    jraKode: 'Kode JRA',
    jraReference: 'Rujukan JRA',
    jraUraian: 'Uraian JRA',
    jraVersion: 'Versi JRA',
    judul: 'Judul',
    jumlah: 'Jumlah',
    jumlahHalaman: 'Jumlah halaman',
    jumlahRangkap: 'Jumlah rangkap',
    kategori: 'Kategori',
    kategoriTerjaga: 'Kategori arsip terjaga',
    kategoriVital: 'Kategori arsip vital',
    keAnggotaId: 'Surat tujuan',
    keJenis: 'Jenis surat tujuan',
    keSuratId: 'Surat tujuan',
    kegiatan: 'Kegiatan',
    kepada: 'Kepada',
    keperluan: 'Keperluan',
    keputusan: 'Keputusan',
    keterangan: 'Keterangan',
    keywords: 'Kata kunci',
    klasifikasiArsip: 'Klasifikasi arsip',
    klasifikasiBaru: 'Klasifikasi baru',
    klasifikasiFasilitatif: 'Klasifikasi fasilitatif',
    klasifikasiFasilitatifKode: 'Kode klasifikasi fasilitatif',
    klasifikasiId: 'Klasifikasi',
    klasifikasiItemId: 'Klasifikasi arsip',
    klasifikasiKeamanan: 'Klasifikasi keamanan',
    klasifikasiKode: 'Kode klasifikasi',
    klasifikasiSubstantif: 'Klasifikasi substantif',
    klasifikasiSubstantifKode: 'Kode klasifikasi substantif',
    klasifikasiUraian: 'Uraian klasifikasi',
    kode: 'Kode',
    kodeKlasifikasi: 'Kode klasifikasi',
    konfirmasi: 'Konfirmasi',
    kurunWaktu: 'Kurun waktu',
    label: 'Label',
    labelTambahan: 'Label disposisi',
    language: 'Bahasa',
    legalBasis: 'Dasar hukum',
    lendingType: 'Jenis peminjaman',
    level: 'Tingkat lokasi',
    limit: 'Jumlah per halaman',
    linkDokumen: 'Link dokumen',
    lokasiBackup: 'Lokasi cadangan',
    lokasiFc: 'Lokasi filing cabinet',
    lokasiFolder: 'Lokasi folder',
    lokasiLaci: 'Lokasi laci',
    manifestNumber: 'Nomor manifest',
    maxRows: 'Jumlah baris maksimal',
    mediaAsal: 'Media asal',
    mediaBackup: 'Media cadangan',
    mediaTujuan: 'Media tujuan',
    mediaType: 'Media arsip',
    metadata: 'Metadata',
    method: 'Metode',
    metodeProteksi: 'Metode proteksi',
    mode: 'Mode',
    name: 'Nama',
    naskahDinas: 'Jenis naskah dinas',
    newDueDate: 'Batas pengembalian baru',
    newPassword: 'Kata sandi baru',
    nextApproverId: 'Penyetuju berikutnya',
    nip: 'NIP',
    noUrut: 'Nomor urut',
    nomor: 'Nomor',
    nomorBeritaAcara: 'Nomor berita acara',
    nomorBerkas: 'Nomor berkas',
    nomorItem: 'Nomor item',
    nomorLaporan: 'Nomor laporan',
    nomorSurat: 'Nomor surat',
    note: 'Catatan',
    notes: 'Catatan',
    notificationIds: 'Daftar notifikasi',
    notificationsEnabled: 'Notifikasi',
    numberingMode: 'Cara penomoran',
    objectSha256: 'Hash berkas',
    objectUri: 'Alamat berkas',
    occurredOn: 'Tanggal kejadian',
    organizationalScope: 'Cakupan organisasi',
    originalFileName: 'Nama berkas',
    outcome: 'Hasil',
    outputAttachmentId: 'Lampiran hasil',
    ownerConfirmed: 'Konfirmasi pemilik',
    page: 'Halaman',
    parentId: 'Lokasi induk',
    parentKode: 'Kode induk',
    password: 'Kata sandi',
    penanggungJawab: 'Penanggung jawab',
    penyelesaianSuratKeluarId: 'Surat keluar penyelesaian',
    performedAt: 'Waktu pelaksanaan',
    perihal: 'Perihal',
    periodePelaporanHari: 'Periode pelaporan (hari)',
    perkembangan: 'Tingkat perkembangan',
    persetujuan: 'Filter persetujuan',
    personInCharge: 'Penanggung jawab',
    prefixHash: 'Awalan hash',
    proposedOutcome: 'Usulan hasil',
    proposedRationale: 'Alasan usulan',
    purpose: 'Tujuan',
    q: 'Kata kunci',
    reason: 'Alasan',
    referenceNumber: 'Nomor rujukan',
    referensi: 'Surat rujukan',
    regulationNumber: 'Nomor peraturan',
    resolusiDPI: 'Resolusi (DPI)',
    retensiAktif: 'Retensi aktif',
    retensiInaktif: 'Retensi inaktif',
    retentionTriggerDate: 'Tanggal pemicu retensi',
    retentionTriggerEvidence: 'Bukti pemicu retensi',
    retentionTriggerLabel: 'Keterangan pemicu retensi',
    retentionTriggerType: 'Jenis pemicu retensi',
    reuseVerifiedSource: 'Pakai sumber terverifikasi',
    role: 'Peran',
    scanCategory: 'Kategori pindai',
    search: 'Kata kunci pencarian',
    sifatSurat: 'Sifat surat',
    sinkron: 'Sinkronkan',
    softwareDigitalisasi: 'Perangkat lunak digitalisasi',
    sourceCode: 'Kode sumber',
    sourceDocumentName: 'Nama dokumen sumber',
    sourceDocumentSha256: 'Hash dokumen sumber',
    sourcePage: 'Halaman sumber',
    sourcePageCount: 'Jumlah halaman sumber',
    sourceRecordKey: 'Kunci data sumber',
    sourceType: 'Jenis sumber',
    sourceUnitId: 'Unit asal',
    sourceUrl: 'Alamat sumber',
    start: 'Awal',
    startRow: 'Baris awal',
    status: 'Status',
    statusProteksi: 'Status proteksi',
    statusVerifikasi: 'Status verifikasi',
    storageLocationId: 'Lokasi simpan',
    sumberId: 'Rangkaian sumber',
    supersedesManifestId: 'Manifest yang diganti',
    suratId: 'Surat',
    suratMasukId: 'Surat masuk',
    tahun: 'Tahun',
    tampilkanDataLama: 'Tampilkan data lama',
    tanggal: 'Tanggal',
    tanggalArsip: 'Tanggal arsip',
    tanggalAutentikasi: 'Tanggal autentikasi',
    tanggalDari: 'Tanggal awal',
    tanggalDigitalisasi: 'Tanggal digitalisasi',
    tanggalKadaluarsa: 'Tanggal kedaluwarsa',
    tanggalMulai: 'Tanggal mulai',
    tanggalPelaporan: 'Tanggal pelaporan',
    tanggalPenetapan: 'Tanggal penetapan',
    tanggalReviewSelanjutnya: 'Tanggal tinjauan berikutnya',
    tanggalSampai: 'Tanggal akhir',
    tanggalSelesai: 'Tanggal selesai',
    tanggalSurat: 'Tanggal surat',
    targetUnitId: 'Unit tujuan',
    targets: 'Unit tujuan disposisi',
    tempatDilakukan: 'Tempat pelaksanaan',
    theme: 'Tema',
    tindakLanjut: 'Tindak lanjut',
    tingkatKekritisan: 'Tingkat kekritisan',
    tingkatPerkembangan: 'Tingkat perkembangan',
    tipe: 'Tipe',
    toolName: 'Nama alat',
    toolVersion: 'Versi alat',
    triggerGuidance: 'Panduan pemicu',
    type: 'Jenis',
    unitKerjaId: 'Unit kerja',
    unitPencatatId: 'Unit pencatat',
    unitPengolah: 'Unit pengolah',
    unitPengolahBaru: 'Unit pengolah baru',
    unitPengolahId: 'Unit pengolah',
    uraian: 'Uraian',
    uraianBerkas: 'Uraian berkas',
    uraianIsi: 'Uraian isi',
    uraianItem: 'Uraian item',
    urutan: 'Urutan',
    userId: 'Pengguna',
    verdict: 'Hasil verifikasi',
    verificationStatement: 'Pernyataan verifikasi',
    verificationStatus: 'Status verifikasi',
    version: 'Versi',
    witnesses: 'Saksi',
};

type Isu = Parameters<z.core.$ZodErrorMap>[0];
type Jalur = ReadonlyArray<PropertyKey>;

function labelKunci(kunci: PropertyKey): string | undefined {
    return typeof kunci === 'string' && Object.hasOwn(LABEL_ISIAN, kunci) ? LABEL_ISIAN[kunci] : undefined;
}

/** Nama isian untuk staf: label kunci terakhir, ditambah urutan baris bila isian ada di dalam daftar. */
export function namaIsian(jalur: Jalur | undefined): string {
    const path = jalur ?? [];
    if (path.length === 0) return 'Data';
    const terakhir = path[path.length - 1];
    if (typeof terakhir === 'number') {
        return `${namaIsian(path.slice(0, -1))} ke-${terakhir + 1}`;
    }
    const label = labelKunci(terakhir) ?? 'Isian';
    let indeks = path.length - 1;
    while (indeks >= 0 && typeof path[indeks] !== 'number') indeks -= 1;
    if (indeks > 0) {
        const induk = labelKunci(path[indeks - 1]);
        if (induk) return `${label} pada ${induk} ke-${(path[indeks] as number) + 1}`;
    }
    return label;
}

function jenisAngka(asal: unknown): boolean {
    return asal === 'number' || asal === 'int' || asal === 'bigint';
}

type IsuCabang = { code?: string; path?: Jalur; message?: string; errors?: ReadonlyArray<ReadonlyArray<IsuCabang>> };

/** Isu tingkat akar yang hanya menyatakan bentuk data tidak cocok (cabang union yang tidak berlaku). */
function hanyaBentukBerbeda(isu: IsuCabang): boolean {
    if ((isu.path?.length ?? 0) > 0) return false;
    if (isu.code === 'invalid_type') return true;
    if (isu.code === 'invalid_union' && Array.isArray(isu.errors) && isu.errors.length > 0) {
        return isu.errors.every((cabang: ReadonlyArray<IsuCabang>) => cabang.length > 0
            && cabang.every((anak: IsuCabang) => hanyaBentukBerbeda(anak)));
    }
    return false;
}

/**
 * Untuk union: bila hanya satu cabang yang cocok bentuknya, pesan cabang itu
 * yang paling menjelaskan (mis. "Unit tujuan disposisi maksimal 10").
 */
export function pesanCabangUnion(isu: { code?: string; errors?: unknown }): string | undefined {
    if (isu.code !== 'invalid_union' || !Array.isArray(isu.errors)) return undefined;
    const cabangRelevan = (isu.errors as Array<Array<IsuCabang>>)
        .filter((cabang) => cabang.length > 0 && !cabang.every((anak) => hanyaBentukBerbeda(anak)));
    if (cabangRelevan.length !== 1) return undefined;
    const pesan = [...new Set(cabangRelevan[0].map((anak) => anak.message).filter(Boolean))];
    return pesan.length > 0 ? pesan.join('; ') : undefined;
}

function pesanTipe(label: string, isu: Isu): string {
    if (isu.input === undefined) return `${label} wajib diisi`;
    const diharapkan = 'expected' in isu ? isu.expected : undefined;
    if (diharapkan === 'number' || diharapkan === 'int' || diharapkan === 'bigint') return `${label} harus berupa angka`;
    if (diharapkan === 'string') return `${label} harus berupa teks`;
    if (diharapkan === 'date') return `${label} harus berupa tanggal yang benar`;
    return `${label} tidak valid`;
}

function pesanTerlaluKecil(label: string, isu: Extract<Isu, { code: 'too_small' }>): string {
    const batas = Number(isu.minimum);
    if (isu.origin === 'string') {
        return batas <= 1 && isu.inclusive !== false ? `${label} wajib diisi` : `${label} minimal ${batas} karakter`;
    }
    if (isu.origin === 'array' || isu.origin === 'set') {
        return batas <= 1 && isu.inclusive !== false ? `${label} wajib dipilih` : `${label} minimal ${batas}`;
    }
    if (isu.origin === 'date') return `${label} tidak boleh sebelum ${String(isu.minimum)}`;
    if (jenisAngka(isu.origin) && isu.inclusive === false) return `${label} harus lebih dari ${String(isu.minimum)}`;
    return `${label} minimal ${String(isu.minimum)}`;
}

function pesanTerlaluBesar(label: string, isu: Extract<Isu, { code: 'too_big' }>): string {
    if (isu.origin === 'string') return `${label} maksimal ${String(isu.maximum)} karakter`;
    if (isu.origin === 'file') return `${label} terlalu besar`;
    if (isu.origin === 'date') return `${label} tidak boleh setelah ${String(isu.maximum)}`;
    if (jenisAngka(isu.origin) && isu.inclusive === false) return `${label} harus kurang dari ${String(isu.maximum)}`;
    return `${label} maksimal ${String(isu.maximum)}`;
}

function pesanFormat(label: string, format: string): string {
    switch (format) {
        case 'email': return `${label} harus berupa alamat email yang benar`;
        case 'url': return `${label} harus berupa alamat lengkap, misalnya https://contoh.go.id`;
        case 'date': return `${label} harus berupa tanggal yang benar`;
        case 'datetime': return `${label} harus berupa tanggal dan jam yang benar`;
        case 'time': return `${label} harus berupa jam yang benar`;
        default: return /^(uuid|guid|cuid2?|ulid|nanoid|xid|ksuid)/.test(format)
            ? `${label} tidak valid`
            : `${label} tidak sesuai format`;
    }
}

function pesanKunciTakDikenal(kunci: readonly string[]): string {
    const label = kunci.map((nama) => labelKunci(nama));
    if (label.length > 0 && label.every(Boolean)) {
        return `Isian ${[...new Set(label)].join(', ')} tidak dikenali di sini. Muat ulang halaman, lalu coba lagi.`;
    }
    return 'Ada isian yang tidak dikenali. Muat ulang halaman, lalu coba lagi.';
}

/** Peta pesan global: selalu mengembalikan teks Indonesia, tidak pernah nama kode atau nilai kiriman. */
export const petaPesanZod: z.core.$ZodErrorMap = (isu) => {
    const label = namaIsian(isu.path);
    switch (isu.code) {
        case 'invalid_type': return pesanTipe(label, isu);
        case 'too_small': return pesanTerlaluKecil(label, isu);
        case 'too_big': return pesanTerlaluBesar(label, isu);
        case 'invalid_format': return pesanFormat(label, isu.format);
        case 'invalid_value': return isu.values.length > 1
            ? `${label} tidak sesuai pilihan yang tersedia`
            : `${label} tidak valid`;
        case 'unrecognized_keys': return pesanKunciTakDikenal(isu.keys);
        case 'invalid_union': return pesanCabangUnion(isu) ?? `${label} tidak valid`;
        default: return `${label} tidak valid`;
    }
};

z.config({ customError: petaPesanZod });
