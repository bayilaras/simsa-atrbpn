import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const state = {
        queuedSelects: [] as any[], queries: [] as any[], writes: [] as any[],
        row: null as any, inTransaction: false, classificationRows: [] as any[],
    };
    function chain(operation: string, fields?: any): any {
        const query: any = { operation, fields, inTransaction: state.inTransaction };
        state.queries.push(query);
        let proxy: any;
        proxy = new Proxy({}, {
            get(_target, method) {
                if (method === 'then') return (resolve: (value: any) => void, reject: (error: unknown) => void) => {
                    if (operation === 'select') {
                        if (fields?.item) return resolve(state.classificationRows);
                        if (!state.queuedSelects.length) return reject(new Error('Unexpected database read in selection flow'));
                        return resolve(state.queuedSelects.shift());
                    }
                    state.writes.push(query);
                    state.row = { id: 'surat-1', ...state.row, ...query.values };
                    return resolve([state.row]);
                };
                return (...args: any[]) => {
                    if (method === 'values' || method === 'set') query.values = args[0];
                    else query[String(method)] = args;
                    return proxy;
                };
            },
        });
        return proxy;
    }
    const db: any = {
        select: (fields?: any) => chain('select', fields), insert: () => chain('insert'), update: () => chain('update'),
        transaction: vi.fn(async (work: (executor: any) => Promise<any>) => {
            state.inTransaction = true;
            try { return await work(db); } finally { state.inTransaction = false; }
        }),
    };
    return {
        state, db, classification: vi.fn(), retention: vi.fn(), audit: vi.fn(),
        incoming: vi.fn(), outgoing: vi.fn(),
        templates: vi.fn(), number: vi.fn(),
    };
});

vi.mock('../config/database', () => ({ db: mocks.db }));
vi.mock('../services/archive-rule-assignment.service', () => ({
    archiveRuleAssignmentService: { resolveClassification: mocks.classification, resolveRetention: mocks.retention },
}));
vi.mock('../services/audit-log.service', () => ({ default: { logActionOrThrow: mocks.audit } }));
vi.mock('../services/srikandi-producer.service', () => ({
    srikandiBusinessProducer: { suratMasukCreated: mocks.incoming, suratKeluarCreated: mocks.outgoing },
}));
vi.mock('../services/settings.service', () => ({
    settingsService: { lockSuratTemplates: mocks.templates, generateSuratNumber: mocks.number },
}));
vi.mock('../services/client-blob-upload.service', () => ({
    clientBlobUploadService: { claimWithExecutor: vi.fn() }, normalizeBlobLocator: (value: unknown) => value,
}));
vi.mock('../services/file-attachment.service', () => ({
    default: { prepareExisting: vi.fn(), insertPrepared: vi.fn() },
}));

import { SuratMasukService } from '../services/surat-masuk.service';
import { SuratKeluarService } from '../services/surat-keluar.service';

const classification = { id: 101, kode: 'UP.04.02', jenis: 'Keprotokolan', tipe: 'fasilitatif', organizationalScope: 'kanwil' };
const retention = { id: 201, kode: 'F.VI.01.0001', uraian: 'Administrasi Persuratan', retensiAktif: '2 tahun', retensiInaktif: '3 tahun', keterangan: 'Musnah' };
const audit = { userId: 'user-1', userEmail: 'test@example.invalid' };
const subjects = [
    { kind: 'masuk', service: new SuratMasukService(), canonical: { klasifikasiKode: classification.kode, klasifikasiUraian: classification.jenis } },
    { kind: 'keluar', service: new SuratKeluarService(), canonical: {
        klasifikasiFasilitatifKode: classification.kode, klasifikasiFasilitatif: classification.jenis,
        klasifikasiSubstantifKode: null, klasifikasiSubstantif: null,
    } },
] as const;

beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.queuedSelects.length = 0;
    mocks.state.queries.length = 0;
    mocks.state.writes.length = 0;
    mocks.state.row = null;
    mocks.state.inTransaction = false;
    mocks.state.classificationRows = [classification,
        { id: 102, kode: 'IP.01.01', jenis: 'Pengukuran Tanah', tipe: 'substantif' }]
        .map(item => ({ item: { ...item, isActive: true, isSelectable: true }, ruleSetStatus: 'active', instrumentType: 'klasifikasi' }));
    mocks.classification.mockReset().mockResolvedValue({ item: classification, ruleSet: { id: 'classification-version' } });
    mocks.retention.mockReset().mockResolvedValue({ item: retention, ruleSet: { id: 'retention-version' } });
    mocks.templates.mockResolvedValue({ masukFormat: 'SM', keluarFormat: 'SK' });
    mocks.number.mockReturnValue('001/TEST/2026');
});

describe.each(subjects)('surat $kind selection flow', ({ kind, service, canonical }) => {
    function existing(extra: Record<string, unknown> = {}) {
        return {
            id: 'surat-1', unitKerjaId: 'unit-1', tanggalSurat: '2026-09-12', perihal: 'Surat lama',
            klasifikasiItemId: 101, jraItemId: 201, ...canonical, ...extra,
        };
    }

    it('persists selected source identities and returns authoritative JRA labels after creation', async () => {
        mocks.state.queuedSelects.push([], [retention]);
        const created = await service.create({
            unitKerjaId: 'unit-1', tanggalSurat: '2026-09-12', tahun: 2026, perihal: 'Surat baru',
            klasifikasiItemId: 101, jraItemId: 201,
            ...Object.fromEntries(Object.keys(canonical).map(key => [key, 'Forged label'])),
        } as any, audit as any);

        expect(mocks.state.writes).toHaveLength(1);
        expect(mocks.state.writes[0]).toMatchObject({ operation: 'insert', inTransaction: true });
        expect(mocks.state.writes[0].values).toMatchObject({ klasifikasiItemId: 101, jraItemId: 201, ...canonical });
        expect(mocks.classification).toHaveBeenCalledWith(mocks.db, { klasifikasiItemId: 101 });
        expect(mocks.retention).toHaveBeenCalledWith(mocks.db, { jraItemId: 201 });
        expect(created).toMatchObject({
            klasifikasiItemId: 101, jraItemId: 201, ...canonical,
            jraKode: retention.kode, jraUraian: retention.uraian,
            jraRetensiAktif: '2 tahun', jraRetensiInaktif: '3 tahun', jraKeterangan: 'Musnah',
        });
        expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
            entityType: `surat_${kind}`,
            changes: expect.objectContaining({ after: expect.objectContaining({ klasifikasiItemId: 101, jraItemId: 201 }) }),
        }), mocks.db);
        expect(mocks.state.queuedSelects).toHaveLength(0);
    });

    it('locks the letter and clears its previous JRA when classification changes', async () => {
        mocks.state.row = existing();
        mocks.state.queuedSelects.push([mocks.state.row]);
        mocks.classification.mockResolvedValue({ item: { id: 102, kode: 'IP.01.01', jenis: 'Pengukuran Tanah', tipe: 'substantif' } });
        const updated = await service.update('surat-1', { klasifikasiItemId: 102 }, 'unit-1');
        expect(mocks.state.queries[0]).toMatchObject({ operation: 'select', for: ['update'], inTransaction: true });
        expect(mocks.state.writes[0].values).toMatchObject({ klasifikasiItemId: 102, jraItemId: null });
        expect(updated).toMatchObject({ klasifikasiItemId: 102, jraItemId: null, perihal: 'Surat lama' });
        expect(mocks.retention).not.toHaveBeenCalled();
        expect(kind === 'masuk' ? (updated as any).klasifikasiKode : (updated as any).klasifikasiSubstantifKode).toBe('IP.01.01');
        if (kind === 'keluar') expect((updated as any).klasifikasiFasilitatifKode).toBeNull();
    });

    it('updates just the JRA while retaining the current classification identity', async () => {
        const revisedRetention = { ...retention, id: 202, kode: 'F.VI.01.0002', retensiInaktif: '5 tahun' };
        mocks.state.row = existing();
        mocks.state.queuedSelects.push([mocks.state.row], [revisedRetention]);
        mocks.retention.mockResolvedValue({ item: revisedRetention });
        const updated = await service.update('surat-1', { jraItemId: 202 }, 'unit-1');
        expect(mocks.retention).toHaveBeenCalledWith(mocks.db, { jraItemId: 202 });
        expect(updated).toMatchObject({ klasifikasiItemId: 101, jraItemId: 202, ...canonical, jraRetensiInaktif: '5 tahun' });
    });

    it('does not mutate an archived or inaccessible letter when the locked lookup has no match', async () => {
        mocks.state.queuedSelects.push([]);
        expect(await service.update('surat-1', { klasifikasiItemId: 101, jraItemId: 201 }, 'unit-1')).toBeUndefined();
        expect(mocks.state.writes).toHaveLength(0);
        expect(mocks.classification).not.toHaveBeenCalled();
        expect(mocks.retention).not.toHaveBeenCalled();
        const query = new PgDialect().sqlToQuery(mocks.state.queries[0].where[0]);
        expect(query.sql).toContain('"is_archived"');
        expect(query.params).toContain('unit-1');
        expect(query.params).toContain(false);
    });

    it('preserves unrelated legacy edits without clearing classification text or inventing identities', async () => {
        mocks.state.row = existing({ klasifikasiItemId: null, jraItemId: null });
        const updated = await service.update('surat-1', { perihal: 'Perihal diperbaiki' }, 'unit-1');
        expect(updated).toMatchObject({ perihal: 'Perihal diperbaiki', klasifikasiItemId: null, jraItemId: null, ...canonical });
        expect(mocks.state.writes[0].values).not.toHaveProperty('klasifikasiItemId');
        expect(mocks.state.writes[0].values).not.toHaveProperty('jraItemId');
        expect(mocks.classification).not.toHaveBeenCalled();
        expect(mocks.retention).not.toHaveBeenCalled();
    });

    it('preserves unchanged historical selections on a full-form edit after their edition is retired', async () => {
        mocks.state.row = existing();
        mocks.state.queuedSelects.push([mocks.state.row], [{ ...retention, isActive: false }]);
        mocks.classification.mockRejectedValue(new Error('Retired classification must not be reselected'));
        mocks.retention.mockRejectedValue(new Error('Retired JRA must not be reselected'));
        const updated = await service.update('surat-1', {
            klasifikasiItemId: 101, jraItemId: 201, perihal: 'Perihal diperbaiki',
            ...Object.fromEntries(Object.keys(canonical).map(key => [key, 'Forged label'])),
        }, 'unit-1');
        expect(updated).toMatchObject({ klasifikasiItemId: 101, jraItemId: 201, ...canonical, jraKode: retention.kode });
        expect(mocks.classification).not.toHaveBeenCalled();
        expect(mocks.retention).not.toHaveBeenCalled();
        expect(mocks.state.queuedSelects).toHaveLength(0);
    });

    it('reads the saved pair in detail and list responses without relying on form state', async () => {
        const saved = existing();
        mocks.state.queuedSelects.push([saved], [retention]);
        expect(await service.findById('surat-1', 'unit-1')).toMatchObject({
            ...canonical, klasifikasiItemId: 101, jraItemId: 201, jraKode: retention.kode,
        });
        mocks.state.queuedSelects.push([{ count: 1 }], [saved], [retention]);
        expect(await service.findAll({ unitKerjaId: 'unit-1' })).toMatchObject({
            data: [expect.objectContaining({ ...canonical, klasifikasiItemId: 101, jraItemId: 201, jraKode: retention.kode })],
            pagination: { total: 1 },
        });
        expect(mocks.state.queuedSelects).toHaveLength(0);
    });

    it('preserves saved IDs on an older full-form metadata edit that resends unchanged labels', async () => {
        mocks.state.row = existing();
        mocks.state.queuedSelects.push([mocks.state.row], [retention]);
        const updated = await service.update('surat-1', { perihal: 'Revised', ...canonical }, 'unit-1');
        expect(updated).toMatchObject({ klasifikasiItemId: 101, jraItemId: 201, ...canonical, perihal: 'Revised' });
        expect(mocks.state.writes[0].values).not.toHaveProperty('klasifikasiItemId');
        expect(mocks.state.writes[0].values).not.toHaveProperty('jraItemId');
        expect(mocks.classification).not.toHaveBeenCalled();
        expect(mocks.retention).not.toHaveBeenCalled();
    });
});
