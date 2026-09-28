import type { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { RANGKAIAN, SURAT, USER_ID, bootRangkaianDatabase, seedRangkaianFixture } from './helpers/rangkaian-pglite';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let access: typeof import('../services/record-access.service');
let spec: typeof import('../services/access/visibility-spec');

function mulberry32(seed: number) {
    let state = seed;
    return () => {
        state = (state + 0x6D2B79F5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const SIFAT = ['', ' ', 'Sangat Segera', 'sangat-segera', ' SANGAT  SEGERA ', 'Rahasia', 'sangat rahasia',
    'Sangat_Rahasia', 'Biasa/Terbuka', 'Penting', 'Undangan', 'rahasia negara', null, 'TERBATAS', 'segera'];
const KELAS_SK = [null, 'biasa', 'terbatas', 'rahasia', 'sangat_rahasia'];
const UNIT_REKAMAN = ['ditjen', 'sesditjen', 'dir_bppt', 'dir_ptep', 'bagian_umum'];
const ROLES = ['super_admin', 'admin_unit', 'admin_dirjen', 'admin_sesditjen', 'staff', 'auditor', 'user', null];
const UNIT_PENGGUNA = ['ditjen', 'sesditjen', 'dir_bppt', 'dir_ptep', 'dir_plp', 'bagian_umum', null, '', '  '];
const ID_PENGGUNA = [...Object.values(USER_ID).filter(id => id !== USER_ID.approver), null];

const literal = (value: string | null) => value === null ? 'NULL' : `'${value.replace(/'/g, "''")}'`;

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    access = await import('../services/record-access.service');
    spec = await import('../services/access/visibility-spec');
    await seedRangkaianFixture(database);
    const sm: string[] = []; const sk: string[] = [];
    // P4-T5-4 (FR:36): unit dan kelas ditarik independen (unit = g % |unit|,
    // kelas = floor(g / |unit|) % |kelas|) sehingga setiap pasangan unit × kelas
    // muncul minimal sekali, termasuk kelas SK NULL di setiap unit.
    for (let g = 1; g <= UNIT_REKAMAN.length * SIFAT.length; g += 1) {
        const id = `31000000-0000-4000-8000-${String(g).padStart(12, '0')}`;
        const sifat = SIFAT[Math.floor(g / UNIT_REKAMAN.length) % SIFAT.length];
        sm.push(`('${id}','${UNIT_REKAMAN[g % UNIT_REKAMAN.length]}',${100 + g},2026,${literal(sifat)},'Varian masuk ${g}')`);
    }
    for (let g = 1; g <= UNIT_REKAMAN.length * KELAS_SK.length; g += 1) {
        const id = `41000000-0000-4000-8000-${String(g).padStart(12, '0')}`;
        const kelas = KELAS_SK[Math.floor(g / UNIT_REKAMAN.length) % KELAS_SK.length];
        sk.push(`('${id}','${UNIT_REKAMAN[g % UNIT_REKAMAN.length]}',${100 + g},2026,${literal(kelas)},'Varian keluar ${g}')`);
    }
    await database.exec(`
        INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, sifat_surat, perihal) VALUES ${sm.join(',')};
        INSERT INTO surat_keluar (id, unit_kerja_id, no_urut, tahun, klasifikasi_keamanan, perihal) VALUES ${sk.join(',')};
        UPDATE surat_masuk SET is_deleted = true WHERE no_urut IN (107, 121);
        INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran, sumber)
            SELECT CASE WHEN no_urut % 2 = 0 THEN '${RANGKAIAN.rs1}'::uuid ELSE '${RANGKAIAN.rs2}'::uuid END, id, unit_kerja_id, 'anggota', 'aplikasi'
            FROM surat_masuk WHERE id::text LIKE '31000000%' AND no_urut % 3 = 0;
        INSERT INTO rangkaian_anggota (rangkaian_id, surat_keluar_id, unit_kerja_id, peran, sumber)
            SELECT '${RANGKAIAN.rs2}'::uuid, id, unit_kerja_id, 'anggota', 'aplikasi'
            FROM surat_keluar WHERE id::text LIKE '41000000%' AND no_urut % 4 = 0;
        INSERT INTO rangkaian_peserta (rangkaian_id, unit_kerja_id, peran, label_asal) VALUES ('${RANGKAIAN.rs2}','dir_bppt','disposisi_lama','BPPT');
        INSERT INTO record_access_grants (requester_id, target_user_id, entity_type, entity_id, unit_kerja_id, required_classification, purpose, access_mode, status, decided_by, decided_at, decision_reason, expires_at)
            SELECT u.id, u.id, 'surat_masuk', s.id, s.unit_kerja_id, 'terbatas', 'Uji properti paritas visibilitas', 'view', 'approved', '${USER_ID.approver}', '2026-09-01T00:00:00Z', 'Uji properti terverifikasi', '2099-01-01T00:00:00Z'
            FROM users u JOIN surat_masuk s ON (s.no_urut + ascii(right(u.id::text, 1))) % 4 = 0
            WHERE s.id::text LIKE '31000000%' AND u.id <> '${USER_ID.approver}';
        INSERT INTO record_access_grants (requester_id, target_user_id, entity_type, entity_id, unit_kerja_id, required_classification, purpose, access_mode, status, decided_by, decided_at, decision_reason, expires_at)
            SELECT u.id, u.id, 'surat_keluar', s.id, s.unit_kerja_id, 'rahasia', 'Uji properti paritas visibilitas', 'view', 'approved', '${USER_ID.approver}', '2026-09-01T00:00:00Z', 'Uji properti terverifikasi', '2099-01-01T00:00:00Z'
            FROM users u JOIN surat_keluar s ON (s.no_urut + ascii(right(u.id::text, 1))) % 3 = 1
            WHERE s.id::text LIKE '41000000%' AND u.id <> '${USER_ID.approver}';
        -- Carried reviewer requirement (progress.md Task 2 → Task 3/4): generator
        -- harus menyertakan grant yang TIDAK boleh membuka apa pun karena terikat
        -- unit lain, kelas lain, atau status non-approved (pending/revoked). Semua
        -- baris di bawah memakai (user, entity) yang belum punya grant approved/
        -- pending pada baseline agar tidak melanggar index unik parsial.
        INSERT INTO record_access_grants (requester_id, target_user_id, entity_type, entity_id, unit_kerja_id, required_classification, purpose, access_mode, status, decided_by, decided_at, decision_reason, expires_at)
            VALUES
                ('${USER_ID.staffSes}','${USER_ID.staffSes}','surat_masuk','${SURAT.smTerbatas}','dir_ptep','terbatas','Uji properti: grant approved terikat unit lain','view','approved','${USER_ID.approver}','2026-09-01T00:00:00Z','Uji properti terverifikasi','2099-01-01T00:00:00Z'),
                ('${USER_ID.adminSesNull}','${USER_ID.adminSesNull}','surat_masuk','${SURAT.smTerbatas}','sesditjen','rahasia','Uji properti: grant approved untuk kelas lain','view','approved','${USER_ID.approver}','2026-09-01T00:00:00Z','Uji properti terverifikasi','2099-01-01T00:00:00Z'),
                ('${USER_ID.ptep}','${USER_ID.ptep}','surat_keluar','${SURAT.skBpptNull}','sesditjen','terbatas','Uji properti: grant approved terikat unit lain','view','approved','${USER_ID.approver}','2026-09-01T00:00:00Z','Uji properti terverifikasi','2099-01-01T00:00:00Z'),
                ('${USER_ID.staffSes}','${USER_ID.staffSes}','surat_keluar','${SURAT.skBpptNull}','dir_bppt','sangat_rahasia','Uji properti: grant approved untuk kelas lain','view','approved','${USER_ID.approver}','2026-09-01T00:00:00Z','Uji properti terverifikasi','2099-01-01T00:00:00Z');
        INSERT INTO record_access_grants (requester_id, target_user_id, entity_type, entity_id, unit_kerja_id, required_classification, purpose, access_mode, status)
            VALUES
                ('${USER_ID.plp}','${USER_ID.plp}','surat_masuk','${SURAT.smTerbatas}','sesditjen','terbatas','Uji properti: grant masih menunggu keputusan','view','pending'),
                ('${USER_ID.superAdmin}','${USER_ID.superAdmin}','surat_keluar','${SURAT.skBpptNull}','dir_bppt','terbatas','Uji properti: grant masih menunggu keputusan','view','pending');
        INSERT INTO record_access_grants (requester_id, target_user_id, entity_type, entity_id, unit_kerja_id, required_classification, purpose, access_mode, status, decided_by, decided_at, decision_reason, expires_at, revoked_by, revoked_at, revocation_reason)
            VALUES
                ('${USER_ID.auditorSes}','${USER_ID.auditorSes}','surat_masuk','${SURAT.smTerbatas}','sesditjen','terbatas','Uji properti: grant sudah dicabut atasan','view','revoked','${USER_ID.approver}','2026-09-01T00:00:00Z','Uji properti terverifikasi','2099-01-01T00:00:00Z','${USER_ID.approver}','2026-09-10T00:00:00Z','Uji properti dicabut'),
                ('${USER_ID.auditorSes}','${USER_ID.auditorSes}','surat_keluar','${SURAT.skBpptNull}','dir_bppt','terbatas','Uji properti: grant sudah dicabut atasan','view','revoked','${USER_ID.approver}','2026-09-01T00:00:00Z','Uji properti terverifikasi','2099-01-01T00:00:00Z','${USER_ID.approver}','2026-09-10T00:00:00Z','Uji properti dicabut');
        -- P4-T5-4 (FR:36): hapus lunak setelah anggota disisipkan — satu SM anggota rs1,
        -- satu SK anggota rs2, dan target satu grant approved (SK, agar berbeda jenis).
        UPDATE surat_masuk SET is_deleted = true WHERE id = (
            SELECT a.surat_masuk_id FROM rangkaian_anggota a JOIN surat_masuk s ON s.id = a.surat_masuk_id
            WHERE a.rangkaian_id = '${RANGKAIAN.rs1}'::uuid AND s.id::text LIKE '31000000%' AND s.is_deleted IS NOT TRUE
            ORDER BY s.no_urut LIMIT 1);
        UPDATE surat_keluar SET is_deleted = true WHERE id = (
            SELECT a.surat_keluar_id FROM rangkaian_anggota a JOIN surat_keluar s ON s.id = a.surat_keluar_id
            WHERE a.rangkaian_id = '${RANGKAIAN.rs2}'::uuid AND s.id::text LIKE '41000000%'
            ORDER BY s.no_urut LIMIT 1);
        UPDATE surat_keluar SET is_deleted = true WHERE id = (
            SELECT g.entity_id FROM record_access_grants g JOIN surat_keluar s ON s.id = g.entity_id
            WHERE g.entity_type = 'surat_keluar' AND g.status = 'approved' AND s.id::text LIKE '41000000%' AND s.is_deleted IS NOT TRUE
            ORDER BY s.no_urut DESC LIMIT 1);
    `);
}, 90_000);
afterAll(async () => { await database?.close(); });
afterEach(() => { delete process.env.RANGKAIAN_DISPOSISI_LAMA_READ; });

async function semuaRef() {
    const rows = spec.barisDari<{ type: 'surat_masuk' | 'surat_keluar'; id: string }>(await holder.db.execute(sql`
        SELECT 'surat_masuk' AS "type", id::text AS "id" FROM surat_masuk
        UNION ALL SELECT 'surat_keluar', id::text FROM surat_keluar`));
    return rows;
}

async function kunciTerlihat(ctx: any, mode: 'read' | 'list') {
    const rows = spec.barisDari<{ key: string }>(await holder.db.execute(sql`
        SELECT 'surat_masuk:' || r.id::text AS "key" FROM surat_masuk r WHERE ${spec.visibleSql(ctx, { type: 'surat_masuk', alias: 'r' }, mode)}
        UNION ALL
        SELECT 'surat_keluar:' || r.id::text FROM surat_keluar r WHERE ${spec.visibleSql(ctx, { type: 'surat_keluar', alias: 'r' }, mode)}`));
    return new Set(rows.map(row => row.key));
}

describe('paritas TS ↔ SQL', () => {
    it.each(SIFAT)('normalisasi sifat %j identik di TS dan SQL', async value => {
        const [row] = spec.barisDari<{ kelas: string }>(await holder.db.execute(
            sql`SELECT ${spec.klasifikasiNormSql(sql`${value}::text`)} AS "kelas"`,
        ));
        expect(row.kelas).toBe(spec.normalizeSecurityClassification(value));
    });

    it('generator mencakup setiap pasangan unit × kelas dan hapus lunak anggota rs1/rs2 serta target grant (P4-T5-4)', async () => {
        const [cakupan] = spec.barisDari<{ sm: number; sk: number; skNull: number }>(await holder.db.execute(sql`
            SELECT (SELECT count(DISTINCT (unit_kerja_id, coalesce(sifat_surat, '<null>')))::int FROM surat_masuk WHERE id::text LIKE '31000000%') AS "sm",
                   (SELECT count(DISTINCT (unit_kerja_id, coalesce(klasifikasi_keamanan, '<null>')))::int FROM surat_keluar WHERE id::text LIKE '41000000%') AS "sk",
                   (SELECT count(DISTINCT unit_kerja_id)::int FROM surat_keluar WHERE id::text LIKE '41000000%' AND klasifikasi_keamanan IS NULL) AS "skNull"`));
        expect(cakupan).toEqual({ sm: UNIT_REKAMAN.length * SIFAT.length, sk: UNIT_REKAMAN.length * KELAS_SK.length, skNull: UNIT_REKAMAN.length });
        const [hapus] = spec.barisDari<{ smRs1: number; skRs2: number; grant: number }>(await holder.db.execute(sql`
            SELECT (SELECT count(*)::int FROM rangkaian_anggota a JOIN surat_masuk s ON s.id = a.surat_masuk_id
                    WHERE a.rangkaian_id = ${RANGKAIAN.rs1}::uuid AND s.is_deleted) AS "smRs1",
                   (SELECT count(*)::int FROM rangkaian_anggota a JOIN surat_keluar s ON s.id = a.surat_keluar_id
                    WHERE a.rangkaian_id = ${RANGKAIAN.rs2}::uuid AND s.is_deleted) AS "skRs2",
                   (SELECT count(*)::int FROM record_access_grants g
                    LEFT JOIN surat_masuk m ON g.entity_type = 'surat_masuk' AND m.id = g.entity_id
                    LEFT JOIN surat_keluar k ON g.entity_type = 'surat_keluar' AND k.id = g.entity_id
                    WHERE g.status = 'approved' AND coalesce(m.is_deleted, k.is_deleted)) AS "grant"`));
        expect(hapus.smRs1).toBeGreaterThan(0);
        expect(hapus.skRs2).toBeGreaterThan(0);
        expect(hapus.grant).toBeGreaterThan(0);
    });

    it('checkRead dan visibleSql(read) identik untuk 300 kombinasi acak', async () => {
        const random = mulberry32(20260926);
        const pick = <T,>(values: readonly T[]) => values[Math.floor(random() * values.length)];
        const refs = await semuaRef();
        for (let i = 0; i < 300; i += 1) {
            const user = i === 0 ? undefined : { id: pick(ID_PENGGUNA), role: pick(ROLES), unitKerjaId: pick(UNIT_PENGGUNA) };
            process.env.RANGKAIAN_DISPOSISI_LAMA_READ = pick(['true', 'false']);
            const hasil = await access.recordAccessService.checkMany(user as any, refs);
            const terlihat = await kunciTerlihat(await spec.resolveKonteksBaca(user as any, holder.db), 'read');
            for (const ref of refs) {
                const key = access.readRefKey(ref);
                expect(terlihat.has(key), JSON.stringify({ i, user, ref, flag: process.env.RANGKAIAN_DISPOSISI_LAMA_READ })).toBe(hasil.get(key)!.allowed);
            }
        }
    }, 180_000);

    it('mode list hanya melonggarkan rekaman unit sendiri sesuai kelasUntukRole', async () => {
        const random = mulberry32(7);
        const pick = <T,>(values: readonly T[]) => values[Math.floor(random() * values.length)];
        const meta = new Map(spec.barisDari<{ key: string; unit: string; raw: string | null; deleted: boolean }>(await holder.db.execute(sql`
            SELECT 'surat_masuk:' || id::text AS "key", unit_kerja_id AS "unit", sifat_surat AS "raw", coalesce(is_deleted, false) AS "deleted" FROM surat_masuk
            UNION ALL SELECT 'surat_keluar:' || id::text, unit_kerja_id, coalesce(klasifikasi_keamanan, 'terbatas'), coalesce(is_deleted, false) FROM surat_keluar`)).map(row => [row.key, row]));
        for (let i = 0; i < 100; i += 1) {
            const user = { id: pick(ID_PENGGUNA), role: pick(ROLES), unitKerjaId: pick(UNIT_PENGGUNA) };
            const ctx = await spec.resolveKonteksBaca(user as any, holder.db);
            const baca = await kunciTerlihat(ctx, 'read');
            const list = await kunciTerlihat(ctx, 'list');
            for (const key of baca) expect(list.has(key), JSON.stringify({ i, user, key })).toBe(true);
            for (const key of list) {
                if (baca.has(key)) continue;
                const row = meta.get(key)!;
                expect(row.deleted).toBe(false);
                expect(spec.cocokUnitRekaman(spec.kecocokanUnitRekaman(user as any), row.unit), JSON.stringify({ i, user, key })).toBe(true);
                expect(spec.kelasUntukRole(user.role)).toContain(spec.normalizeSecurityClassification(row.raw));
            }
        }
    }, 120_000);
});

// Ruling controller pada counterexample 1: root cause adalah
// normalizeSecurityClassification/klasifikasiNormSql yang tidak idempoten
// untuk nilai murni whitespace (' ' -> '' pada satu kali, tapi '' dianggap
// falsy dan menjadi 'biasa' pada satu kali lagi). Diperbaiki di sumber (P0)
// alih-alih di titik panggil evaluateOwnerAccess, agar check() tidak
// berubah perilaku (snapshot Task 1 tetap hijau tanpa -u). Blok ini
// mengunci perbaikan itu secara eksplisit.
describe('regresi: normalisasi klasifikasi idempoten (ruling controller)', () => {
    it("normalizeSecurityClassification(' ') === 'biasa', bukan ''", () => {
        expect(spec.normalizeSecurityClassification(' ')).toBe('biasa');
    });

    it('normalizeSecurityClassification idempoten untuk seluruh nilai generator dan alias', () => {
        const nilai: Array<string | null> = [
            ...SIFAT, ...KELAS_SK, ...spec.BIASA_SIFAT_ALIASES, ...spec.SECURITY_CLASSES,
            '\t', ' ', '   ', '',
        ];
        for (const value of nilai) {
            const sekali = spec.normalizeSecurityClassification(value);
            const duaKali = spec.normalizeSecurityClassification(sekali);
            expect(duaKali, JSON.stringify({ value, sekali })).toBe(sekali);
        }
    });

    it("klasifikasiNormSql(' ') === 'biasa' di SQL, setara dengan TS", async () => {
        const [row] = spec.barisDari<{ kelas: string }>(await holder.db.execute(
            sql`SELECT ${spec.klasifikasiNormSql(sql`${' '}::text`)} AS "kelas"`,
        ));
        expect(row.kelas).toBe('biasa');
        expect(row.kelas).toBe(spec.normalizeSecurityClassification(' '));
    });

    it('check() pada surat_masuk bersifat murni whitespace tetap mengizinkan staff (biasa) seperti sebelumnya', async () => {
        // g=6 dari seed di atas (generator P4-T5-4): unit_kerja_id='sesditjen', sifat_surat=' '.
        const staff = { id: USER_ID.staffSes, role: 'staff', unitKerjaId: 'sesditjen' };
        const hasil = await access.recordAccessService.check(
            staff as any, 'surat_masuk', '31000000-0000-4000-8000-000000000006',
        );
        expect(hasil).toMatchObject({ exists: true, allowed: true, mutable: true, classification: ' ' });
    });
});
