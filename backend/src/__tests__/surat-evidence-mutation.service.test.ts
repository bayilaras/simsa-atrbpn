import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const resultQueue: any[] = [];
const whereConditions: any[] = [];

const chain: any = new Proxy({}, {
    get(_target, prop) {
        if (prop === 'then') {
            const value = resultQueue.shift() ?? [];
            return (resolve: (result: any) => void) => resolve(value);
        }
        return (...args: any[]) => {
            if (prop === 'where') whereConditions.push(args[0]);
            return chain;
        };
    },
});

const mockDb = {
    select: (..._args: any[]) => chain,
    insert: (..._args: any[]) => chain,
    update: (..._args: any[]) => chain,
    delete: (..._args: any[]) => chain,
    transaction: async (callback: any) => callback(mockDb),
};

vi.mock('../config/database', () => ({ db: mockDb }));

const { SuratMasukService } = await import('../services/surat-masuk.service');
const { SuratKeluarService } = await import('../services/surat-keluar.service');

function renderedLastWhere() {
    return new PgDialect().sqlToQuery(whereConditions[whereConditions.length - 1]);
}

describe('surat evidentiary source mutation guards', () => {
    beforeEach(() => {
        resultQueue.length = 0;
        whereConditions.length = 0;
    });

    it('conditionally updates incoming letters only while live and not archived', async () => {
        resultQueue.push([{ id: 'sm-1' }]);
        await new SuratMasukService().update('sm-1', { perihal: 'Koreksi' }, 'unit-a');

        const query = renderedLastWhere();
        expect(query.sql).toContain('"surat_masuk"."is_deleted"');
        expect(query.sql).toContain('"surat_masuk"."is_archived"');
        expect(query.params.filter((value) => value === false)).toHaveLength(2);
    });

    it('conditionally soft-deletes incoming letters only before archival', async () => {
        resultQueue.push([{ id: 'sm-1' }]);
        await new SuratMasukService().delete('sm-1', 'user-1', 'unit-a');

        const query = renderedLastWhere();
        expect(query.sql).toContain('"surat_masuk"."is_deleted"');
        expect(query.sql).toContain('"surat_masuk"."is_archived"');
        expect(query.params.filter((value) => value === false)).toHaveLength(2);
    });

    it('conditionally updates outgoing letters only while live and not archived', async () => {
        resultQueue.push([{ id: 'sk-1' }]);
        await new SuratKeluarService().update('sk-1', { perihal: 'Koreksi' }, 'unit-a');

        const query = renderedLastWhere();
        expect(query.sql).toContain('"surat_keluar"."is_deleted"');
        expect(query.sql).toContain('"surat_keluar"."is_archived"');
        expect(query.params.filter((value) => value === false)).toHaveLength(2);
    });

    it('conditionally soft-deletes outgoing letters only before archival', async () => {
        resultQueue.push([{ id: 'sk-1' }]);
        await new SuratKeluarService().delete('sk-1', 'user-1', 'unit-a');

        const query = renderedLastWhere();
        expect(query.sql).toContain('"surat_keluar"."is_deleted"');
        expect(query.sql).toContain('"surat_keluar"."is_archived"');
        expect(query.params.filter((value) => value === false)).toHaveLength(2);
    });
});
