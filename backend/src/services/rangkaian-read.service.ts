import { sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
    readRefKey,
    recordAccessService,
    requiresExplicitAccessGrant,
    type ReadAccessResult,
    type ReadExecutor,
    type ReadVia,
    type RecordUser,
} from './record-access.service';
import {
    barisDari,
    dalamCakupanPengawas,
    isAjukanAksesEnabled,
    jangkauanSql,
    resolveKonteksBaca,
    type JenisRekamanRangkaian,
    type KonteksBaca,
} from './access/visibility-spec';

export const BATAS_NODE_DETAIL = 300;
export const BATAS_RANGKAIAN_TERKAIT = 5;
/**
 * Batas hop saat mengikuti rantai digabung_ke_id (A→B→C→...). Baris yang
 * sudah digabung tidak dapat diubah lagi (trigger rangkaian_guard_status di
 * migrasi 0046), sehingga rantai nyata bersifat asiklik dan pendek; batas
 * ini murni jaga-jaga defensif terhadap data yang rusak, bukan skenario yang
 * diharapkan terjadi.
 */
export const BATAS_HOP_GABUNG = 16;
export const LABEL_DIKECUALIKAN = 'Dikecualikan' as const;

export type AksesRangkaian = 'owner' | 'pengawas' | 'peserta';

export interface AnggotaTerlihat {
    anggotaId: string;
    jenis: JenisRekamanRangkaian;
    suratId: string;
    peran: 'induk' | 'anggota';
    unitKerjaId: string;
    unitNama: string;
    nomorSurat: string | null;
    perihal: string | null;
    tanggalSurat: string | null;
    dari: string | null;
    kepada: string | null;
    naskahDinas: string | null;
    approvalStatus: string | null;
    ditambahkanAt: string;
    masked: false;
    aksesMelalui: ReadVia;
}

export interface AnggotaTersamar {
    anggotaId: string;
    jenis: JenisRekamanRangkaian;
    unitNama: string;
    label: typeof LABEL_DIKECUALIKAN;
    masked: true;
    dapatAjukanAkses: boolean;
}

export interface RelasiRangkaian {
    id: string;
    dariAnggotaId: string;
    keAnggotaId: string;
    jenisRelasi: 'balasan' | 'tindak_lanjut' | 'menjelaskan' | 'merujuk';
    keterangan: string | null;
    createdAt: string;
}

export interface DisposisiRangkaian {
    id: string;
    suratMasukAnggotaId: string | null;
    targetUnit: { id: string; nama: string };
    status: 'sent' | 'received' | 'processed' | 'rejected';
    sentAt: string;
    receivedAt: string | null;
    processedAt: string | null;
    batasWaktu: string | null;
    penanggungJawab: boolean;
    ditutupPengawas: boolean;
    instruction: string | null;
    catatanPenyelesaian: string | null;
    rejectionReason: string | null;
    penyelesaianAnggotaId: string | null;
    masked: boolean;
}

export interface PesertaRangkaian {
    unitKerjaId: string;
    nama: string;
    sumber: 'pencatat' | 'pengolah' | 'penulis' | 'disposisi' | 'disposisi_lama';
}

export interface RangkaianTerkait {
    id: string;
    kode: string;
    status: string;
    hubungan: 'lanjutan_dari' | 'dilanjutkan_oleh';
}

export interface RangkaianDetail {
    rangkaian: {
        id: string;
        kode: string;
        status: 'aktif' | 'selesai' | 'diberkaskan' | 'digabung';
        asal: string;
        judul: string;
        tahun: number;
        unitPencatat: { id: string; nama: string };
        unitPengolah: { id: string; nama: string } | null;
        klasifikasiItemId: number | null;
        lanjutanDariId: string | null;
        selesaiAt: string | null;
        selesaiManual: boolean;
        diberkaskanAt: string | null;
        createdAt: string;
    };
    dialihkanDari: { id: string; kode: string } | null;
    aksesMelalui: AksesRangkaian;
    peserta: PesertaRangkaian[];
    anggota: Array<AnggotaTerlihat | AnggotaTersamar>;
    relasi: RelasiRangkaian[];
    disposisi: DisposisiRangkaian[];
    rangkaianTerkait: RangkaianTerkait[];
    aksiDiizinkan: string[];
    truncated: boolean;
}

interface BarisRangkaian {
    id: string; kode: string; asal: string; status: RangkaianDetail['rangkaian']['status'];
    judul: string; tahun: number;
    unitPencatatId: string; unitPencatatNama: string;
    unitPengolahId: string | null; unitPengolahNama: string | null;
    klasifikasiItemId: number | null; lanjutanDariId: string | null; digabungKeId: string | null;
    selesaiAt: unknown; selesaiManual: boolean; diberkaskanAt: unknown; createdAt: unknown;
}

interface BarisAnggota {
    anggotaId: string; peran: 'induk' | 'anggota'; unitKerjaId: string; unitNama: string;
    ditambahkanAt: unknown; jenis: JenisRekamanRangkaian; suratId: string;
    nomorSurat: string | null; perihal: string | null; tanggalSurat: string | null;
    dari: string | null; kepada: string | null; naskahDinas: string | null; approvalStatus: string | null;
}

interface BarisRelasi {
    id: string; dariAnggotaId: string; keAnggotaId: string;
    jenisRelasi: RelasiRangkaian['jenisRelasi']; keterangan: string | null; createdAt: unknown;
}

interface BarisDisposisi {
    id: string; suratMasukId: string; targetUnitId: string; targetUnitNama: string;
    status: DisposisiRangkaian['status']; instruction: string | null; rejectionReason: string | null;
    catatanPenyelesaian: string | null; batasWaktu: string | null; penanggungJawab: boolean;
    ditutupPengawas: boolean; penyelesaianSuratKeluarId: string | null;
    sentAt: unknown; receivedAt: unknown; processedAt: unknown;
}

function iso(value: unknown): string | null {
    if (value == null) return null;
    if (value instanceof Date) return value.toISOString();
    return String(value);
}

export function samarkanAnggota(
    row: { anggotaId: string; jenis: JenisRekamanRangkaian; unitNama: string },
    dapatAjukanAkses: boolean,
): AnggotaTersamar {
    return {
        anggotaId: row.anggotaId,
        jenis: row.jenis,
        unitNama: row.unitNama,
        label: LABEL_DIKECUALIKAN,
        masked: true,
        dapatAjukanAkses,
    };
}

export function judulTersamar(kode: string): string {
    return `Rangkaian ${kode} (${LABEL_DIKECUALIKAN})`;
}

async function muatRangkaian(executor: ReadExecutor, id: string): Promise<BarisRangkaian | null> {
    const [row] = barisDari<BarisRangkaian>(await executor.execute(sql`
        SELECT rs.id::text AS "id", rs.kode AS "kode", rs.asal AS "asal", rs.status AS "status",
               rs.judul AS "judul", rs.tahun AS "tahun",
               rs.unit_pencatat_id AS "unitPencatatId", up.name AS "unitPencatatNama",
               rs.unit_pengolah_id AS "unitPengolahId", uo.name AS "unitPengolahNama",
               rs.klasifikasi_item_id AS "klasifikasiItemId",
               rs.lanjutan_dari_id::text AS "lanjutanDariId", rs.digabung_ke_id::text AS "digabungKeId",
               rs.selesai_at AS "selesaiAt", rs.selesai_manual AS "selesaiManual",
               rs.diberkaskan_at AS "diberkaskanAt", rs.created_at AS "createdAt"
        FROM rangkaian_surat rs
        JOIN unit_kerja up ON up.id = rs.unit_pencatat_id
        LEFT JOIN unit_kerja uo ON uo.id = rs.unit_pengolah_id
        WHERE rs.id = ${id}::uuid
        LIMIT 1
    `));
    return row ?? null;
}

async function muatAnggota(executor: ReadExecutor, rangkaianId: string): Promise<BarisAnggota[]> {
    return barisDari<BarisAnggota>(await executor.execute(sql`
        SELECT a.id::text AS "anggotaId", a.peran AS "peran", a.unit_kerja_id AS "unitKerjaId", u.name AS "unitNama",
               a.ditambahkan_at AS "ditambahkanAt",
               CASE WHEN a.surat_masuk_id IS NOT NULL THEN 'surat_masuk' ELSE 'surat_keluar' END AS "jenis",
               coalesce(a.surat_masuk_id, a.surat_keluar_id)::text AS "suratId",
               coalesce(sm.nomor_surat, sk.nomor_surat) AS "nomorSurat",
               coalesce(sm.perihal, sk.perihal) AS "perihal",
               to_char(coalesce(sm.tanggal_surat, sk.tanggal_surat), 'YYYY-MM-DD') AS "tanggalSurat",
               sm.dari AS "dari", sk.kepada AS "kepada",
               sk.naskah_dinas AS "naskahDinas", sk.approval_status AS "approvalStatus"
        FROM rangkaian_anggota a
        JOIN unit_kerja u ON u.id = a.unit_kerja_id
        LEFT JOIN surat_masuk sm ON sm.id = a.surat_masuk_id
        LEFT JOIN surat_keluar sk ON sk.id = a.surat_keluar_id
        WHERE a.rangkaian_id = ${rangkaianId}::uuid
          AND coalesce(sm.is_deleted, sk.is_deleted) IS NOT TRUE
        ORDER BY (a.peran = 'induk') DESC, a.ditambahkan_at, a.id
        LIMIT ${BATAS_NODE_DETAIL + 1}
    `));
}

async function muatRelasi(executor: ReadExecutor, rangkaianId: string): Promise<BarisRelasi[]> {
    return barisDari<BarisRelasi>(await executor.execute(sql`
        SELECT r.id::text AS "id", r.dari_anggota_id::text AS "dariAnggotaId", r.ke_anggota_id::text AS "keAnggotaId",
               r.jenis_relasi AS "jenisRelasi", r.keterangan AS "keterangan", r.created_at AS "createdAt"
        FROM rangkaian_relasi r
        WHERE r.rangkaian_id = ${rangkaianId}::uuid AND r.cancelled_at IS NULL
        ORDER BY r.created_at, r.id
    `));
}

async function muatDisposisi(executor: ReadExecutor, rangkaianId: string): Promise<BarisDisposisi[]> {
    return barisDari<BarisDisposisi>(await executor.execute(sql`
        SELECT d.id::text AS "id", d.surat_masuk_id::text AS "suratMasukId",
               d.target_unit_id AS "targetUnitId", u.name AS "targetUnitNama",
               d.status AS "status", d.instruction AS "instruction", d.rejection_reason AS "rejectionReason",
               d.catatan_penyelesaian AS "catatanPenyelesaian", to_char(d.batas_waktu, 'YYYY-MM-DD') AS "batasWaktu",
               d.penanggung_jawab AS "penanggungJawab", d.ditutup_pengawas AS "ditutupPengawas",
               d.penyelesaian_surat_keluar_id::text AS "penyelesaianSuratKeluarId",
               d.sent_at AS "sentAt", d.received_at AS "receivedAt", d.processed_at AS "processedAt"
        FROM surat_distributions d
        JOIN unit_kerja u ON u.id = d.target_unit_id
        WHERE d.rangkaian_id = ${rangkaianId}::uuid
        ORDER BY d.sent_at, d.id
    `));
}

async function muatPeserta(executor: ReadExecutor, rangkaianId: string, disposisiLamaRead: boolean): Promise<PesertaRangkaian[]> {
    const lama = disposisiLamaRead
        ? sql`UNION ALL SELECT p.unit_kerja_id, 'disposisi_lama', 5 FROM rangkaian_peserta p WHERE p.rangkaian_id = ${rangkaianId}::uuid AND p.berakhir_at IS NULL`
        : sql.empty();
    return barisDari<PesertaRangkaian>(await executor.execute(sql`
        SELECT DISTINCT ON (j.unit_kerja_id) j.unit_kerja_id AS "unitKerjaId", u.name AS "nama", j.sumber AS "sumber"
        FROM (
            SELECT rs.unit_pencatat_id AS unit_kerja_id, 'pencatat' AS sumber, 1 AS urutan FROM rangkaian_surat rs WHERE rs.id = ${rangkaianId}::uuid
            UNION ALL SELECT rs.unit_pengolah_id, 'pengolah', 2 FROM rangkaian_surat rs WHERE rs.id = ${rangkaianId}::uuid AND rs.unit_pengolah_id IS NOT NULL
            UNION ALL SELECT a.unit_kerja_id, 'penulis', 3 FROM rangkaian_anggota a WHERE a.rangkaian_id = ${rangkaianId}::uuid
            UNION ALL SELECT d.target_unit_id, 'disposisi', 4 FROM surat_distributions d WHERE d.rangkaian_id = ${rangkaianId}::uuid AND d.status <> 'rejected'
            ${lama}
        ) j
        JOIN unit_kerja u ON u.id = j.unit_kerja_id
        ORDER BY j.unit_kerja_id, j.urutan
    `));
}

async function muatTerkait(executor: ReadExecutor, rangkaianId: string): Promise<RangkaianTerkait[]> {
    return barisDari<RangkaianTerkait>(await executor.execute(sql`
        SELECT t.id::text AS "id", t.kode AS "kode", t.status AS "status", t.hubungan AS "hubungan"
        FROM (
            SELECT r.id, r.kode, r.status, 'lanjutan_dari' AS hubungan, r.created_at
            FROM rangkaian_surat r
            WHERE r.id = (SELECT lanjutan_dari_id FROM rangkaian_surat WHERE id = ${rangkaianId}::uuid)
            UNION ALL
            SELECT r.id, r.kode, r.status, 'dilanjutkan_oleh', r.created_at
            FROM rangkaian_surat r
            WHERE r.lanjutan_dari_id = ${rangkaianId}::uuid
        ) t
        ORDER BY t.created_at, t.id
        LIMIT ${BATAS_RANGKAIAN_TERKAIT}
    `));
}

async function tingkatRangkaian(
    executor: ReadExecutor,
    ctx: KonteksBaca,
    rs: BarisRangkaian,
): Promise<AksesRangkaian | null> {
    if (ctx.user?.role === 'super_admin') return 'owner';
    if (ctx.pengawas && dalamCakupanPengawas(rs.unitPencatatId)) return 'pengawas';
    if (ctx.unitJangkauan) {
        const [row] = barisDari<{ peserta: boolean }>(await executor.execute(
            sql`SELECT ${jangkauanSql(sql`${rs.id}::uuid`, ctx.unitJangkauan, ctx.disposisiLamaRead)} AS "peserta"`,
        ));
        if (row?.peserta === true) return 'peserta';
    }
    return null;
}

export const rangkaianReadService = {
    async findRangkaianIdBySurat(
        jenis: JenisRekamanRangkaian,
        suratId: string,
        executor: ReadExecutor = db,
    ): Promise<string | null> {
        const kolom = sql.raw(jenis === 'surat_masuk' ? 'surat_masuk_id' : 'surat_keluar_id');
        const [row] = barisDari<{ rangkaianId: string }>(await executor.execute(
            sql`SELECT rangkaian_id::text AS "rangkaianId" FROM rangkaian_anggota WHERE ${kolom} = ${suratId}::uuid LIMIT 1`,
        ));
        return row?.rangkaianId ?? null;
    },

    /**
     * Rangkaian tersamar untuk pembaca. null → 404 (tidak ada jalur baca).
     * Pembaca "penuh" (super_admin, pengawas, peserta) mendapat placeholder
     * untuk node yang tidak boleh dibaca; pembaca tanpa jangkauan hanya
     * menerima node yang dapat dibacanya.
     */
    async getDetail(
        user: RecordUser | undefined,
        rangkaianId: string,
        executor: ReadExecutor = db,
    ): Promise<RangkaianDetail | null> {
        let rs = await muatRangkaian(executor, rangkaianId);
        if (!rs) return null;
        let dialihkanDari: RangkaianDetail['dialihkanDari'] = null;
        if (rs.status === 'digabung' && rs.digabungKeId) {
            // Rantai gabung (A→B→C) terjadi bila B masih aktif ketika A
            // digabung ke B, dan B baru digabung ke C setelahnya -- baris
            // yang sudah digabung tidak pernah diperbarui lagi. dialihkanDari
            // selalu menunjuk rangkaian yang ASLINYA diminta (A), bukan hop
            // antara, walau resolusi mengikuti seluruh rantai ke target akhir.
            const asal: RangkaianDetail['dialihkanDari'] = { id: rs.id, kode: rs.kode };
            const dikunjungi = new Set<string>([rs.id]);
            let hop = 0;
            while (rs.status === 'digabung' && rs.digabungKeId) {
                if (hop >= BATAS_HOP_GABUNG || dikunjungi.has(rs.digabungKeId)) return null;
                const target = await muatRangkaian(executor, rs.digabungKeId);
                if (!target) return null;
                dikunjungi.add(target.id);
                rs = target;
                hop += 1;
            }
            dialihkanDari = asal;
        }

        const ctx = await resolveKonteksBaca(user, executor);
        const barisAnggota = await muatAnggota(executor, rs.id);
        const truncated = barisAnggota.length > BATAS_NODE_DETAIL;
        const dipakai = barisAnggota.slice(0, BATAS_NODE_DETAIL);
        const akses = await recordAccessService.checkMany(
            user,
            dipakai.map(row => ({ type: row.jenis, id: row.suratId })),
            executor,
        );
        const aksesAnggota = (row: BarisAnggota): ReadAccessResult | undefined =>
            akses.get(readRefKey({ type: row.jenis, id: row.suratId }));
        const tingkat = await tingkatRangkaian(executor, ctx, rs);
        const penuh = tingkat !== null;
        if (!penuh && !dipakai.some(row => aksesAnggota(row)?.allowed === true)) return null;

        const dapatAjukan = isAjukanAksesEnabled();
        const terlihat = new Set<string>();
        const tersamar = new Set<string>();
        const anggota: Array<AnggotaTerlihat | AnggotaTersamar> = [];
        // Jalur lintas unit terbaik di antara anggota yang benar-benar
        // terlihat (checkMany per surat), dipakai sebagai jatuhan aksesMelalui
        // saat tier rangkaian (tingkat) null -- lihat komentar di aksesMelalui.
        let viaLintas: 'pengawas' | 'peserta' | null = null;
        for (const row of dipakai) {
            const a = aksesAnggota(row);
            if (a?.allowed && a.via) {
                terlihat.add(row.anggotaId);
                if (a.via === 'pengawas') viaLintas = 'pengawas';
                else if (a.via === 'peserta' && viaLintas !== 'pengawas') viaLintas = 'peserta';
                anggota.push({
                    anggotaId: row.anggotaId,
                    jenis: row.jenis,
                    suratId: row.suratId,
                    peran: row.peran,
                    unitKerjaId: row.unitKerjaId,
                    unitNama: row.unitNama,
                    nomorSurat: row.nomorSurat,
                    perihal: row.perihal,
                    tanggalSurat: row.tanggalSurat,
                    dari: row.jenis === 'surat_masuk' ? row.dari : null,
                    kepada: row.jenis === 'surat_keluar' ? row.kepada : null,
                    naskahDinas: row.naskahDinas,
                    approvalStatus: row.approvalStatus,
                    ditambahkanAt: iso(row.ditambahkanAt)!,
                    masked: false,
                    aksesMelalui: a.via,
                });
            } else if (penuh) {
                tersamar.add(row.anggotaId);
                // C-2: kelas tak dikenal juga tersamar, tetapi requestViaRangkaian menolaknya (409).
                anggota.push(samarkanAnggota(row, dapatAjukan && a?.masked === true && requiresExplicitAccessGrant(a?.classification)));
            }
        }
        const tampil = (id: string) => terlihat.has(id) || tersamar.has(id);
        const induk = dipakai.find(row => row.peran === 'induk');
        const judul = induk && terlihat.has(induk.anggotaId) ? rs.judul : judulTersamar(rs.kode);

        const relasi: RelasiRangkaian[] = (await muatRelasi(executor, rs.id))
            .filter(row => tampil(row.dariAnggotaId) && tampil(row.keAnggotaId))
            .map(row => ({
                id: row.id,
                dariAnggotaId: row.dariAnggotaId,
                keAnggotaId: row.keAnggotaId,
                jenisRelasi: row.jenisRelasi,
                keterangan: terlihat.has(row.dariAnggotaId) && terlihat.has(row.keAnggotaId) ? row.keterangan : null,
                createdAt: iso(row.createdAt)!,
            }));

        const anggotaSm = new Map(dipakai.filter(row => row.jenis === 'surat_masuk').map(row => [row.suratId, row]));
        const anggotaSk = new Map(dipakai.filter(row => row.jenis === 'surat_keluar').map(row => [row.suratId, row]));
        const disposisi: DisposisiRangkaian[] = [];
        for (const row of await muatDisposisi(executor, rs.id)) {
            const sm = anggotaSm.get(row.suratMasukId);
            const smTerlihat = Boolean(sm && terlihat.has(sm.anggotaId));
            if (!penuh && !smTerlihat) continue;
            const sk = row.penyelesaianSuratKeluarId ? anggotaSk.get(row.penyelesaianSuratKeluarId) : undefined;
            disposisi.push({
                id: row.id,
                suratMasukAnggotaId: sm && tampil(sm.anggotaId) ? sm.anggotaId : null,
                targetUnit: { id: row.targetUnitId, nama: row.targetUnitNama },
                status: row.status,
                sentAt: iso(row.sentAt)!,
                receivedAt: iso(row.receivedAt),
                processedAt: iso(row.processedAt),
                batasWaktu: row.batasWaktu,
                penanggungJawab: row.penanggungJawab === true,
                ditutupPengawas: row.ditutupPengawas === true,
                instruction: smTerlihat ? row.instruction : null,
                catatanPenyelesaian: smTerlihat ? row.catatanPenyelesaian : null,
                rejectionReason: smTerlihat ? row.rejectionReason : null,
                penyelesaianAnggotaId: sk && terlihat.has(sk.anggotaId) ? sk.anggotaId : null,
                masked: !smTerlihat,
            });
        }

        return {
            rangkaian: {
                id: rs.id,
                kode: rs.kode,
                status: rs.status,
                asal: rs.asal,
                judul,
                tahun: Number(rs.tahun),
                unitPencatat: { id: rs.unitPencatatId, nama: rs.unitPencatatNama },
                unitPengolah: rs.unitPengolahId ? { id: rs.unitPengolahId, nama: rs.unitPengolahNama ?? rs.unitPengolahId } : null,
                klasifikasiItemId: rs.klasifikasiItemId,
                // Sama seperti rangkaianTerkait: seorang pembaca tanpa jangkauan
                // pada level RANGKAIAN ini (penuh===false) yang hanya melihat
                // payloadnya karena satu anggota kebetulan terbaca (viaLintas)
                // tidak berhak mengetahui rangkaian lanjutan lain -- itu adalah
                // fakta pada level rangkaian, bukan pada level surat anggota.
                lanjutanDariId: penuh ? rs.lanjutanDariId : null,
                selesaiAt: iso(rs.selesaiAt),
                selesaiManual: rs.selesaiManual === true,
                diberkaskanAt: iso(rs.diberkaskanAt),
                createdAt: iso(rs.createdAt)!,
            },
            dialihkanDari,
            // Tier rangkaian (tingkat) menilai jangkauan atas RANGKAIAN itu
            // sendiri (unit_pencatat_id / jangkauanSql atas rangkaian ini).
            // Bila null, pembaca tidak "penuh" pada level rangkaian -- tetapi
            // checkMany menilai jangkauan PER SURAT, dan bisa saja meloloskan
            // satu atau lebih anggota lewat jalur lintas unit (pengawas atas
            // unit anggota tertentu, atau peserta atas rangkaian anggota lain
            // yang kebetulan surat itu juga menjadi anggotanya) walau
            // rangkaian ini sendiri di luar jangkauan pembaca. Melabeli
            // pembacaan itu 'owner' menyembunyikan pembacaan lintas unit dari
            // gerbang audit hilir yang melewatkan via==='owner' (spec §4.10).
            // Jatuhkan ke jalur lintas unit terbaik di antara anggota yang
            // terlihat sebelum menjatuhkan ke 'owner' yang sesungguhnya murni
            // milik sendiri (tidak ada anggota yang terlihat lewat jalur
            // lintas unit sama sekali).
            aksesMelalui: tingkat ?? viaLintas ?? 'owner',
            peserta: penuh ? await muatPeserta(executor, rs.id, ctx.disposisiLamaRead) : [],
            anggota,
            relasi,
            disposisi,
            rangkaianTerkait: penuh ? await muatTerkait(executor, rs.id) : [],
            aksiDiizinkan: [],
            truncated,
        };
    },
};

export default rangkaianReadService;
