import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
    allowedSecurityClassifications,
    isAllowedForRecordUnit,
} from '../../record-access.service';
import {
    cocokUnitRekaman,
    dalamCakupanPengawas,
    isAjukanAksesEnabled,
    isDisposisiLamaReadEnabled,
    jalurJangkauan,
    kecocokanUnitRekaman,
    kelasBolehDibacaLintasUnit,
    kelasUntukRole,
    unitJangkauan,
    visibleSql,
    type KonteksBaca,
} from '../visibility-spec';

const dialect = new PgDialect();
const render = (query: ReturnType<typeof visibleSql>) => dialect.sqlToQuery(query).sql;
const ctx = (patch: Partial<KonteksBaca> = {}): KonteksBaca => ({
    user: { id: '10000000-0000-4000-8000-000000000002', role: 'admin_unit', unitKerjaId: 'sesditjen' },
    unitJangkauan: 'sesditjen',
    pengawas: true,
    disposisiLamaRead: false,
    ...patch,
});

describe('kelas per role', () => {
    it.each(['super_admin', 'admin_unit', 'admin_dirjen', 'admin_sesditjen', 'staff', 'auditor', 'user', '', null, undefined])(
        'allowedSecurityClassifications mendelegasikan ke kelasUntukRole untuk %s',
        role => {
            expect(allowedSecurityClassifications({ role } as any)).toEqual(kelasUntukRole(role));
        },
    );
    it('menetapkan kelas yang sama dengan kebijakan pra-P2', () => {
        expect(kelasUntukRole('super_admin')).toEqual(['biasa', 'terbatas', 'rahasia', 'sangat_rahasia']);
        expect(kelasUntukRole('admin_unit')).toEqual(['biasa', 'terbatas']);
        expect(kelasUntukRole('staff')).toEqual(['biasa']);
        expect(kelasUntukRole('user')).toEqual([]);
    });
});

describe('kecocokan unit rekaman (sumber tunggal isAllowedForRecordUnit)', () => {
    it.each([
        [{ role: 'admin_unit', unitKerjaId: 'dir_bppt' }, 'dir_bppt', true],
        [{ role: 'admin_unit', unitKerjaId: ' ' }, ' ', false],
        [{ role: 'admin_unit', unitKerjaId: ' dir_bppt' }, 'dir_bppt', false],
        [{ role: 'admin_unit', unitKerjaId: null }, 'dir_bppt', false],
        [{ role: 'staff', unitKerjaId: '' }, '', false],
        [{ role: 'staff', unitKerjaId: 'sesditjen' }, 'sesditjen', true],
        [{ role: 'auditor', unitKerjaId: 'sesditjen' }, 'ditjen', false],
        [{ role: 'admin_dirjen', unitKerjaId: null }, 'ditjen', true],
        [{ role: 'admin_sesditjen', unitKerjaId: 'dir_bppt' }, 'sesditjen', true],
        [{ role: 'admin_sesditjen', unitKerjaId: 'dir_bppt' }, 'dir_bppt', false],
        [{ role: 'super_admin', unitKerjaId: null }, 'bagian_umum', true],
        [{ role: 'user', unitKerjaId: 'dir_bppt' }, 'dir_bppt', false],
        [undefined, 'dir_bppt', false],
    ])('%j terhadap unit %s → %s', (user, unit, expected) => {
        expect(isAllowedForRecordUnit(user as any, unit)).toBe(expected);
        expect(cocokUnitRekaman(kecocokanUnitRekaman(user as any), unit)).toBe(expected);
    });
});

describe('pengawas dan jangkauan', () => {
    it.each([
        ['ditjen', true], ['sesditjen', true], ['dir_bppt', true], ['dir_plp', true],
        ['direktorat-bppt', false], ['bagian_umum', false], ['', false], [null, false],
    ])('cakupan rekaman pengawas %s → %s', (unit, expected) => {
        expect(dalamCakupanPengawas(unit as any)).toBe(expected);
    });
    it.each([
        [{ role: 'super_admin', unitKerjaId: 'sesditjen' }, null],
        [{ role: 'admin_sesditjen', unitKerjaId: null }, 'sesditjen'],
        [{ role: 'admin_dirjen', unitKerjaId: 'dir_bppt' }, 'ditjen'],
        [{ role: 'admin_unit', unitKerjaId: ' dir_bppt ' }, 'dir_bppt'],
        [{ role: 'admin_unit', unitKerjaId: '' }, null],
        [{ role: 'staff', unitKerjaId: 'sesditjen' }, null],
        [{ role: 'auditor', unitKerjaId: 'sesditjen' }, null],
        [{ role: 'user', unitKerjaId: 'sesditjen' }, null],
        [undefined, null],
    ])('unit jangkauan %j → %s', (user, expected) => {
        expect(unitJangkauan(user as any)).toBe(expected);
    });
    it('memilih pengawas lebih dulu, lalu peserta, dan tidak pernah tanpa unit jangkauan', () => {
        expect(jalurJangkauan(ctx(), 'dir_bppt', true)).toBe('pengawas');
        expect(jalurJangkauan(ctx(), 'bagian_umum', true)).toBe('peserta');
        expect(jalurJangkauan(ctx({ pengawas: false }), 'dir_bppt', false)).toBeNull();
        expect(jalurJangkauan(ctx({ pengawas: false, unitJangkauan: null }), 'dir_bppt', true)).toBeNull();
    });
    it('kelas lintas unit: biasa sesuai role, terkendali wajib grant, tak dikenal selalu ditolak', () => {
        expect(kelasBolehDibacaLintasUnit({ role: 'admin_unit' }, 'biasa', false)).toBe(true);
        expect(kelasBolehDibacaLintasUnit({ role: 'user' }, 'biasa', false)).toBe(false);
        expect(kelasBolehDibacaLintasUnit({ role: 'admin_unit' }, 'terbatas', false)).toBe(false);
        expect(kelasBolehDibacaLintasUnit({ role: 'admin_unit' }, 'terbatas', true)).toBe(true);
        expect(kelasBolehDibacaLintasUnit({ role: 'admin_unit' }, 'rahasia_negara', true)).toBe(false);
    });
    it('flag hanya menyala untuk string persis true', () => {
        expect(isDisposisiLamaReadEnabled({ RANGKAIAN_DISPOSISI_LAMA_READ: 'true' })).toBe(true);
        expect(isDisposisiLamaReadEnabled({ RANGKAIAN_DISPOSISI_LAMA_READ: '1' })).toBe(false);
        expect(isDisposisiLamaReadEnabled({})).toBe(false);
        expect(isAjukanAksesEnabled({ RANGKAIAN_AJUKAN_AKSES: 'true' })).toBe(true);
        expect(isAjukanAksesEnabled({ RANGKAIAN_AJUKAN_AKSES: 'TRUE' })).toBe(false);
    });
});

describe('visibleSql', () => {
    it('memperlakukan klasifikasi surat keluar NULL sebagai terbatas', () => {
        expect(render(visibleSql(ctx(), { type: 'surat_keluar', alias: 'r' }))).toContain("coalesce(r.klasifikasi_keamanan, 'terbatas')");
    });
    it('hanya menyertakan cakupan pengawas bila konteks pengawas', () => {
        expect(render(visibleSql(ctx(), { type: 'surat_masuk', alias: 'r' }))).toContain("left(r.unit_kerja_id, 4) = 'dir_'");
        expect(render(visibleSql(ctx({ pengawas: false }), { type: 'surat_masuk', alias: 'r' }))).not.toContain("left(r.unit_kerja_id, 4)");
    });
    it('hanya membaca rangkaian_peserta saat flag data lama menyala', () => {
        expect(render(visibleSql(ctx(), { type: 'surat_masuk', alias: 'r' }))).not.toContain('rangkaian_peserta');
        expect(render(visibleSql(ctx({ disposisiLamaRead: true }), { type: 'surat_masuk', alias: 'r' }))).toContain('rangkaian_peserta');
    });
    it('tidak menjangkau rangkaian tanpa unit jangkauan dan tidak memeriksa grant tanpa id pengguna', () => {
        const text = render(visibleSql(ctx({ unitJangkauan: null, pengawas: false, user: { role: 'staff', unitKerjaId: 'sesditjen' } }), { type: 'surat_masuk', alias: 'r' }));
        expect(text).not.toContain('rangkaian_anggota');
        expect(text).not.toContain('record_access_grants');
    });
    it('menolak alias yang bukan identifier sederhana', () => {
        expect(() => visibleSql(ctx(), { type: 'surat_masuk', alias: 'r; DROP TABLE x' })).toThrow(/alias/i);
    });
    it.each(['ra', 'g', 'j'])(
        'menolak alias internal builder (%s) agar tidak bertumpang tindih dengan subkueri jangkauan/grant',
        alias => {
            expect(() => visibleSql(ctx(), { type: 'surat_masuk', alias })).toThrow(/alias/i);
            expect(() => visibleSql(ctx(), { type: 'surat_keluar', alias })).toThrow(/alias/i);
        },
    );
    it.each(['jk_ra', 'jk_r', 'jk_g', 'jk_j', 'jk_anything'])(
        'menolak alias berprefiks cadangan jk_ (%s) yang dipakai builder jangkauan/grant',
        alias => {
            expect(() => visibleSql(ctx(), { type: 'surat_masuk', alias })).toThrow(/alias/i);
            expect(() => visibleSql(ctx(), { type: 'surat_keluar', alias })).toThrow(/alias/i);
        },
    );
    it('menerima SQLWrapper sebagai id rangkaian dan mengikat unit sebagai parameter', () => {
        // pengawas: false agar literal konstanta cakupan pengawas tidak ikut dirender.
        const query = dialect.sqlToQuery(visibleSql(ctx({ pengawas: false }), { type: 'surat_masuk', alias: 'sm' }));
        expect(query.params).toContain('sesditjen');
        expect(query.sql).not.toContain("'sesditjen'");
        expect(query.sql).toContain('sm.sifat_surat');
        expect(sql`x`).toBeDefined();
    });
});
