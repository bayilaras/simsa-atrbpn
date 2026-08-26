import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { ArchiveRuleAssignmentService } from '../services/archive-rule-assignment.service';

type RecordedCall = { method: PropertyKey; args: any[] };

function createExecutor(...results: any[]) {
    const calls: RecordedCall[] = [];
    const queue = [...results];
    let chain: any;

    chain = new Proxy({}, {
        get(_target, prop) {
            if (prop === 'then') {
                const value = queue.shift() ?? [];
                return (resolve: (result: any) => void) => resolve(value);
            }
            return (...args: any[]) => {
                calls.push({ method: prop, args });
                return chain;
            };
        },
    });

    const executor = {
        select: (...args: any[]) => {
            calls.push({ method: 'select', args });
            return chain;
        },
        insert: (...args: any[]) => {
            calls.push({ method: 'insert', args });
            return chain;
        },
        update: (...args: any[]) => {
            calls.push({ method: 'update', args });
            return chain;
        },
    };

    return { executor, calls, queue };
}

const classification = {
    item: {
        id: 10,
        kode: 'PT.01.01',
        sourceCode: 'PT.01.01',
        sourceRecordKey: 'atr10-2018:kementerian:0100',
        organizationalScope: 'kementerian',
        jenis: 'Pengadaan Tanah',
        keterangan: 'Berkas pengadaan tanah',
        tipe: 'substantif',
        parentKode: 'PT.01',
        contentHash: 'b'.repeat(64),
        sourcePage: 31,
    },
    ruleSet: {
        id: 'classification-set',
        version: 'ATR-BPN-10-2018',
        legalBasis: 'Permen ATR/BPN Nomor 10 Tahun 2018',
        sourceDocumentSha256: '1'.repeat(64),
    },
};

const retention = {
    item: {
        id: 20,
        kode: 'S.VI.A.0001',
        uraian: 'Pengadaan tanah',
        retensiAktif: '2 tahun',
        retensiInaktif: '3 tahun',
        activeMonths: 24,
        inactiveMonths: 36,
        calculationMode: 'duration',
        dispositionCode: 'musnah',
        keterangan: 'Musnah',
        triggerGuidance: 'Setelah berkas ditutup',
        contentHash: 'c'.repeat(64),
        sourcePage: 53,
    },
    ruleSet: {
        id: 'retention-set',
        version: 'ATR-BPN-8-2020',
        legalBasis: 'Permen ATR/BPN Nomor 8 Tahun 2020',
        sourceDocumentSha256: '2'.repeat(64),
    },
};

describe('ArchiveRuleAssignmentService', () => {
    let service: ArchiveRuleAssignmentService;

    beforeEach(() => {
        service = new ArchiveRuleAssignmentService();
    });

    it('resolves only active, selectable Ministry classification and active selectable JRA', async () => {
        const { executor, calls } = createExecutor([classification], [retention]);

        const result = await service.resolveActive(executor, {
            klasifikasiItemId: 10,
            jraItemId: 20,
        });

        const whereCalls = calls.filter(call => call.method === 'where');
        expect(whereCalls).toHaveLength(2);

        const dialect = new PgDialect();
        const classificationQuery = dialect.sqlToQuery(whereCalls[0].args[0]);
        expect(classificationQuery.sql).toContain('"regulatory_rule_sets"."instrument_type"');
        expect(classificationQuery.sql).toContain('"regulatory_rule_sets"."status"');
        expect(classificationQuery.sql).toContain('"klasifikasi_arsip"."is_selectable"');
        expect(classificationQuery.sql).toContain('"klasifikasi_arsip"."organizational_scope"');
        expect(classificationQuery.params).toEqual(expect.arrayContaining([
            'klasifikasi', 'active', true, 'kementerian', 10,
        ]));

        const retentionQuery = dialect.sqlToQuery(whereCalls[1].args[0]);
        expect(retentionQuery.sql).toContain('"jadwal_retensi_arsip"."is_selectable"');
        expect(retentionQuery.params).toEqual(expect.arrayContaining(['jra', 'active', true, 20]));

        expect(result.cache).toMatchObject({
            kodeKlasifikasi: 'PT.01.01',
            klasifikasiArsipId: 10,
            klasifikasiRuleSetId: 'classification-set',
            jraItemId: 20,
            jraRuleSetId: 'retention-set',
            hasilAkhir: 'Musnah',
            ruleProvenanceStatus: 'verified',
        });
        expect(result.snapshot.classification.sourceRecordKey)
            .toBe('atr10-2018:kementerian:0100');
        expect(result.snapshotSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(result.cache.klasifikasiSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
        expect(result.cache.retentionDecisionHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('rejects an ambiguous official classification code and requires item identity', async () => {
        const duplicate = {
            ...classification,
            item: {
                ...classification.item,
                id: 11,
                sourceRecordKey: 'atr10-2018:kementerian:0101',
            },
        };
        const { executor, calls } = createExecutor([classification, duplicate]);

        await expect(service.resolveActive(executor, {
            kodeKlasifikasi: 'PT.01.01',
            jraItemId: 20,
        })).rejects.toThrow(/lebih dari satu butir resmi/i);

        expect(calls.filter(call => call.method === 'select')).toHaveLength(1);
        expect(calls.find(call => call.method === 'limit')?.args[0]).toBe(2);
    });

    it('maps a conditional or compound disposition to manual appraisal', async () => {
        const conditionalRetention = {
            ...retention,
            item: {
                ...retention.item,
                dispositionCode: 'manual_review',
                keterangan: 'Permanen, kecuali duplikat dapat dimusnahkan',
            },
        };
        const { executor } = createExecutor([classification], [conditionalRetention]);

        const result = await service.resolveActive(executor, {
            klasifikasiItemId: 10,
            jraItemId: 20,
        });

        expect(result.cache.hasilAkhir).toBe('Dinilai Kembali');
    });

    it('creates revision one and only updates the archive pointer/cache status', async () => {
        const assignment = await service.resolveActive(
            createExecutor([classification], [retention]).executor,
            { klasifikasiItemId: 10, jraItemId: 20 },
        );
        const snapshotRecord = { id: 'snapshot-1', revision: 1 };
        const updatedArchive = {
            id: 'archive-1',
            currentRuleSnapshotId: 'snapshot-1',
            ruleProvenanceStatus: 'verified',
        };
        const { executor, calls } = createExecutor([snapshotRecord], [updatedArchive]);

        await expect(service.attachInitialSnapshot(
            executor,
            'archive-1',
            assignment,
            'user-1',
        )).resolves.toEqual(updatedArchive);

        const inserted = calls.find(call => call.method === 'values')?.args[0];
        expect(inserted).toMatchObject({
            arsipId: 'archive-1',
            revision: 1,
            status: 'verified',
            snapshotSha256: assignment.snapshotSha256,
            reason: 'Registrasi awal berdasarkan master peraturan aktif.',
            createdBy: 'user-1',
        });
        const archiveSet = calls.find(call => call.method === 'set')?.args[0];
        expect(archiveSet).toMatchObject({
            currentRuleSnapshotId: 'snapshot-1',
            ruleProvenanceStatus: 'verified',
        });
    });

    it('appends the next evidence revision and refreshes cache from canonical rules', async () => {
        const assignment = await service.resolveActive(
            createExecutor([classification], [retention]).executor,
            { klasifikasiItemId: 10, jraItemId: 20 },
        );
        const previous = { id: 'snapshot-3', revision: 3 };
        const appended = { id: 'snapshot-4', revision: 4 };
        const archive = { id: 'archive-1', currentRuleSnapshotId: 'snapshot-4' };
        const { executor, calls } = createExecutor([previous], [appended], [archive]);

        const result = await service.appendRevision(
            executor,
            'archive-1',
            assignment,
            'Koreksi klasifikasi setelah verifikasi petugas',
            '2020-01-31',
            'user-1',
        );

        expect(result).toEqual({ archive, snapshot: appended });
        const inserted = calls.find(call => call.method === 'values')?.args[0];
        expect(inserted).toMatchObject({
            arsipId: 'archive-1',
            revision: 4,
            supersedesSnapshotId: 'snapshot-3',
            snapshot: assignment.snapshot,
            reason: 'Koreksi klasifikasi setelah verifikasi petugas',
            createdBy: 'user-1',
        });

        const archiveSet = calls.find(call => call.method === 'set')?.args[0];
        expect(archiveSet).toMatchObject({
            ...assignment.cache,
            tanggalKadaluarsa: '2025-01-31',
            currentRuleSnapshotId: 'snapshot-4',
            ruleProvenanceStatus: 'verified',
        });
        expect(calls.filter(call => call.method === 'insert')).toHaveLength(1);
        expect(calls.filter(call => call.method === 'update')).toHaveLength(1);
    });
});
