import { beforeEach, describe, expect, it, vi } from 'vitest';

const resultQueue: any[] = [];
function enqueue(...results: any[]) { resultQueue.push(...results); }

const mockChain: any = new Proxy({}, {
    get(_target, prop) {
        if (prop === 'then') {
            const value = resultQueue.shift() ?? [];
            return (resolve: any) => resolve(value);
        }
        return (..._args: any[]) => mockChain;
    },
});

vi.mock('../config/database', () => ({
    db: {
        select: (..._args: any[]) => mockChain,
    },
}));

const { supervisionService } = await import('../services/supervision.service');

describe('SupervisionService retention compliance', () => {
    beforeEach(() => {
        resultQueue.length = 0;
    });

    it('returns the scoped overdue-retention compliance count', async () => {
        enqueue([{ count: 2 }]); // expired, triggered, non-held archives
        enqueue([{ count: 1 }]); // unverified electronic archives
        enqueue([{ count: 3 }]); // new archives this month

        const result = await supervisionService.getComplianceStats();
        expect(result).toEqual({
            overdueRetention: 2,
            unverifiedElectronic: 1,
            newArchivesThisMonth: 3,
        });
    });
});
