import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const rules = vi.hoisted(() => ({ resolveClassification: vi.fn(), resolveRetention: vi.fn() }));
vi.mock('../services/archive-rule-assignment.service', () => ({ archiveRuleAssignmentService: rules }));
import { hydrateSuratRuleSelections, prepareSuratRuleSelection } from '../services/surat-rule-selection.service';
import { createSuratMasukSchema, createSuratKeluarSchema, updateSuratMasukSchema, updateSuratKeluarSchema } from '../validators/schemas';

describe('persisted surat classification and JRA selections', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        rules.resolveClassification.mockResolvedValue({ item: { id: 12, kode: 'TU.02.03', jenis: 'Jadwal Retensi Arsip', tipe: 'fasilitatif' } });
        rules.resolveRetention.mockResolvedValue({ item: { id: 23 } });
    });

    it('retains the exact official item identity when codes are duplicated', async () => {
        const selection = await prepareSuratRuleSelection({}, 'masuk', {
            klasifikasiItemId: 12, jraItemId: 23, klasifikasiKode: 'FORGED', klasifikasiUraian: 'Wrong label',
        });
        expect(selection).toEqual({ klasifikasiItemId: 12, jraItemId: 23, klasifikasiKode: 'TU.02.03', klasifikasiUraian: 'Jadwal Retensi Arsip' });
        expect(rules.resolveClassification).toHaveBeenCalledWith({}, { klasifikasiItemId: 12 });
        expect(rules.resolveRetention).toHaveBeenCalledWith({}, { jraItemId: 23 });
    });

    it('stores substantive outgoing classifications in the substantive fields', async () => {
        rules.resolveClassification.mockResolvedValue({ item: { kode: 'PT.01.01', jenis: 'Pengadaan tanah', tipe: 'substantif' } });
        expect(await prepareSuratRuleSelection({}, 'keluar', { klasifikasiItemId: 12, jraItemId: 23 })).toEqual({
            klasifikasiItemId: 12, jraItemId: 23,
            klasifikasiFasilitatifKode: null, klasifikasiFasilitatif: null,
            klasifikasiSubstantifKode: 'PT.01.01', klasifikasiSubstantif: 'Pengadaan tanah',
        });
    });

    it('keeps an unchanged JRA during a partial classification update', async () => {
        expect(await prepareSuratRuleSelection({}, 'masuk', { klasifikasiItemId: 12 }, { klasifikasiItemId: 12, jraItemId: 23 }))
            .toMatchObject({ klasifikasiItemId: 12, jraItemId: 23 });
    });

    it('clears the previous JRA when classification changes without a new JRA', async () => {
        expect(await prepareSuratRuleSelection({}, 'masuk', { klasifikasiItemId: 12 }, { klasifikasiItemId: 11, jraItemId: 23 }))
            .toMatchObject({ klasifikasiItemId: 12, jraItemId: null });
        expect(rules.resolveRetention).not.toHaveBeenCalled();
    });

    it('preserves retired selections on an unrelated edit without accepting forged labels', async () => {
        rules.resolveClassification.mockRejectedValue(new Error('Retired'));
        rules.resolveRetention.mockRejectedValue(new Error('Retired'));
        expect(await prepareSuratRuleSelection({}, 'masuk', {
            klasifikasiItemId: 12, jraItemId: 23, klasifikasiUraian: 'Forged title', perihal: 'Koreksi',
        }, { klasifikasiItemId: 12, jraItemId: 23, klasifikasiKode: 'TU.02.03', klasifikasiUraian: 'JRA resmi' }))
            .toEqual({ klasifikasiItemId: 12, jraItemId: 23, klasifikasiKode: 'TU.02.03', klasifikasiUraian: 'JRA resmi' });
        expect(rules.resolveClassification).not.toHaveBeenCalled();
        expect(rules.resolveRetention).not.toHaveBeenCalled();
    });

    it('clears both identities and old descriptions when a selection is removed', async () => {
        expect(await prepareSuratRuleSelection({}, 'masuk', { klasifikasiItemId: null }, { klasifikasiItemId: 12, jraItemId: 23 }))
            .toEqual({ klasifikasiItemId: null, jraItemId: null, klasifikasiKode: null, klasifikasiUraian: null });
    });

    it('requires classification before a standalone JRA selection', async () => {
        await expect(prepareSuratRuleSelection({}, 'masuk', { jraItemId: 23 })).rejects.toThrow(/klasifikasi arsip sebelum/);
    });

    it('rejects an inactive item before persisting any metadata', async () => {
        rules.resolveRetention.mockRejectedValue(new Error('JRA tidak ditemukan pada versi aktif'));
        await expect(prepareSuratRuleSelection({}, 'masuk', { klasifikasiItemId: 12, jraItemId: 23 })).rejects.toThrow(/versi aktif/);
    });

    it('preserves selections on unrelated edits but invalidates them on legacy text edits', async () => {
        expect(await prepareSuratRuleSelection({}, 'masuk', { perihal: 'Koreksi' })).toEqual({});
        expect(await prepareSuratRuleSelection({}, 'masuk', { klasifikasiKode: 'KU.01' }))
            .toEqual({ klasifikasiItemId: null, jraItemId: null });
        expect(rules.resolveClassification).not.toHaveBeenCalled();
    });

    it('preserves saved identities when a cached legacy form resends unchanged classification text', async () => {
        const current = { klasifikasiItemId: 12, jraItemId: 23, klasifikasiKode: 'TU.02.03', klasifikasiUraian: 'JRA resmi' };
        expect(await prepareSuratRuleSelection({}, 'masuk', {
            perihal: 'Koreksi', klasifikasiKode: 'TU.02.03', klasifikasiUraian: 'JRA resmi',
        }, current)).toEqual({});
        expect(await prepareSuratRuleSelection({}, 'masuk', { klasifikasiKode: 'KU.01' }, current))
            .toEqual({ klasifikasiItemId: null, jraItemId: null });
    });

    it('repairs a unique legacy substantive display without inventing saved IDs or JRA', async () => {
        const item = { id: 12, kode: 'BP.02.02', jenis: 'Bimbingan Teknis dan Supervisi', tipe: 'substantif',
            organizationalScope: 'kementerian', isActive: true, isSelectable: true };
        const where = vi.fn().mockResolvedValue([{ item, ruleSetStatus: 'active', instrumentType: 'klasifikasi' }]);
        const executor = { select: vi.fn(() => ({ from: () => ({ leftJoin: () => ({ where }) }) })) };
        const [result] = await hydrateSuratRuleSelections(executor, [{ klasifikasiItemId: null, jraItemId: null,
            klasifikasiFasilitatifKode: 'BP.02.02', klasifikasiFasilitatif: 'Wrong category' }], 'keluar');
        expect(result).toMatchObject({ klasifikasiItemId: null, jraItemId: null, klasifikasiFasilitatifKode: null,
            klasifikasiSubstantifKode: 'BP.02.02', klasifikasiSubstantif: item.jenis, klasifikasiTipe: 'substantif' });
        expect(result).not.toHaveProperty('jraKode');
        expect(executor.select).toHaveBeenCalledTimes(1);
    });

    it('keeps ambiguous legacy codes unbound and never uses a retired match to infer a label', async () => {
        const legacy = { klasifikasiItemId: null, jraItemId: null, klasifikasiKode: 'AT.01', klasifikasiUraian: 'Original' };
        const item = { id: 12, kode: 'AT.01', jenis: 'Catalog label', tipe: 'substantif', isActive: true, isSelectable: true };
        const where = vi.fn().mockResolvedValue([
            { item, ruleSetStatus: 'active', instrumentType: 'klasifikasi' },
            { item: { ...item, id: 13 }, ruleSetStatus: 'active', instrumentType: 'klasifikasi' },
        ]);
        const executor = { select: vi.fn(() => ({ from: () => ({ leftJoin: () => ({ where }) }) })) };
        expect(await hydrateSuratRuleSelections(executor, [legacy], 'masuk')).toEqual([legacy]);
        where.mockResolvedValue([{ item, ruleSetStatus: 'retired', instrumentType: 'klasifikasi' }]);
        expect(await hydrateSuratRuleSelections(executor, [legacy], 'masuk')).toEqual([legacy]);
    });

    it('hydrates saved retention by ID even after the rule has been retired', async () => {
        const where = vi.fn().mockResolvedValue([{ id: 23, kode: 'F.III.A.0001', uraian: 'Berkas', retensiAktif: '2 tahun', retensiInaktif: '3 tahun', keterangan: 'Musnah', isActive: false }]);
        const executor = { select: vi.fn(() => ({ from: () => ({ where }) })) };
        const records = await hydrateSuratRuleSelections(executor, [{ jraItemId: 23 }, { jraItemId: 23 }, { jraItemId: null }]);
        expect(records[0]).toMatchObject({ jraKode: 'F.III.A.0001', jraRetensiAktif: '2 tahun', jraRetensiInaktif: '3 tahun', jraKeterangan: 'Musnah' });
        expect(records[2]).toMatchObject({ jraItemId: null, jraKode: null });
        expect(executor.select).toHaveBeenCalledTimes(1);
        const query = new PgDialect().sqlToQuery(where.mock.calls[0][0]);
        expect(query.params).toEqual([23]);
        expect(query.sql).not.toContain('is_active');
    });

    it('never invents a JRA for legacy letters', async () => {
        const executor = { select: vi.fn() };
        const rows = [{ jraItemId: null }, {}];
        expect(await hydrateSuratRuleSelections(executor, rows)).toEqual(rows);
        expect(executor.select).not.toHaveBeenCalled();
    });

    it('accepts both identities in incoming and outgoing API payloads, excluding client retention text', () => {
        const fields = { klasifikasiItemId: '12', jraItemId: '23', retensiAktif: '999 tahun' };
        const common = { unitKerjaId: 'unit-a', tanggalSurat: '2026-09-12', perihal: 'Surat', ...fields };
        for (const result of [createSuratMasukSchema.parse({ ...common, dari: 'Pengirim' }), createSuratKeluarSchema.parse({ ...common, kepada: 'Penerima' })]) {
            expect(result).toMatchObject({ klasifikasiItemId: 12, jraItemId: 23 });
            expect(result).not.toHaveProperty('retensiAktif');
        }
        for (const schema of [updateSuratMasukSchema, updateSuratKeluarSchema]) {
            expect(schema.parse({ klasifikasiItemId: null, jraItemId: null })).toEqual({ klasifikasiItemId: null, jraItemId: null });
            expect(schema.safeParse({ jraItemId: '' }).success).toBe(false);
            expect(schema.parse({ perihal: 'Koreksi' })).not.toHaveProperty('jraItemId');
        }
    });
});
