import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const resultQueue: any[] = [];
const whereConditions: any[] = [];

const mockChain: any = new Proxy({}, {
    get(_target, prop) {
        if (prop === 'then') {
            const value = resultQueue.shift() ?? [];
            return (resolve: any) => resolve(value);
        }
        return (...args: any[]) => {
            if (prop === 'where') whereConditions.push(args[0]);
            return mockChain;
        };
    },
});

vi.mock('../config/database', () => ({
    db: {
        select: () => mockChain,
        insert: () => mockChain,
        update: () => mockChain,
        delete: () => mockChain,
    },
}));

const { SuratKeluarService } = await import('../services/surat-keluar.service');
const dialect = new PgDialect();
const render = (condition: any) => dialect.sqlToQuery(condition).sql;

describe('SuratKeluarService.findAll: filter soft-delete', () => {
    beforeEach(() => {
        resultQueue.length = 0;
        whereConditions.length = 0;
    });

    it.each([
        ['unit tertentu', { unitKerjaId: 'dir_bppt' }],
        ['semua unit (super_admin)', { unitKerjaId: null }],
        ['dengan pencarian dan kelas', { unitKerjaId: 'dir_bppt', search: 'nota', securityClassifications: ['biasa', 'terbatas'] }],
    ])('memakai IS NOT TRUE agar baris lama is_deleted NULL tetap tampil: %s', async (_label, filters) => {
        resultQueue.push([{ count: 0 }], []);
        await new SuratKeluarService().findAll(filters as any);
        const [countWhere, dataWhere] = whereConditions;
        for (const condition of [countWhere, dataWhere]) {
            const text = render(condition);
            expect(text).toMatch(/"surat_keluar"\."is_deleted" IS NOT TRUE/i);
            expect(text).not.toMatch(/"is_deleted" = \$/);
        }
    });
});
