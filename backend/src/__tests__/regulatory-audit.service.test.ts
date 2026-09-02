import { describe, expect, it } from 'vitest';
import {
    appendRegulatoryEvents,
    verifyRegulatoryEventChain,
} from '../services/regulatory-audit.service';

function transactionDouble(options: { rejectInsert?: boolean } = {}) {
    let inserted: any[] = [];
    const operations: string[] = [];
    const selectChain: any = {
        from: () => selectChain,
        where: () => selectChain,
        orderBy: () => selectChain,
        limit: async () => {
            operations.push('read-head');
            return [];
        },
    };
    return {
        inserted: () => inserted,
        operations: () => operations,
        tx: {
            execute: async () => {
                operations.push('lock-rule-set');
                return [];
            },
            select: () => selectChain,
            insert: () => ({
                values: async (rows: any[]) => {
                    if (options.rejectInsert) throw new Error('audit storage unavailable');
                    operations.push('insert-events');
                    inserted = rows;
                },
            }),
        },
    };
}

describe('regulatory governance audit chain', () => {
    it('chains before/after events and detects later tampering', async () => {
        const double = transactionDouble();
        await appendRegulatoryEvents(double.tx, [
            {
                ruleSetId: '22222222-2222-4222-8222-222222222222',
                instrumentType: 'klasifikasi',
                entityType: 'item',
                itemId: 1,
                itemCode: 'KU.01',
                action: 'create',
                after: { jenis: 'Keuangan' },
            },
            {
                ruleSetId: '22222222-2222-4222-8222-222222222222',
                instrumentType: 'klasifikasi',
                entityType: 'item',
                itemId: 1,
                itemCode: 'KU.01',
                action: 'update',
                before: { jenis: 'Keuangan' },
                after: { jenis: 'Keuangan negara' },
            },
        ], { actorId: '11111111-1111-4111-8111-111111111111' });

        const rows = double.inserted();
        expect(rows).toHaveLength(2);
        expect(rows[1].previousEventHash).toBe(rows[0].eventHash);
        expect(verifyRegulatoryEventChain(rows)).toMatchObject({ valid: true, checkedEvents: 2 });
        expect(double.operations()).toEqual(['lock-rule-set', 'read-head', 'insert-events']);

        const tampered = rows.map((row) => ({ ...row }));
        tampered[0].after = { jenis: 'diubah diam-diam' };
        expect(verifyRegulatoryEventChain(tampered)).toMatchObject({
            valid: false,
            brokenEventId: rows[0].id,
        });
    });

    it('fails closed when transactional audit evidence cannot be inserted', async () => {
        const double = transactionDouble({ rejectInsert: true });
        await expect(appendRegulatoryEvents(double.tx, [{
            ruleSetId: '22222222-2222-4222-8222-222222222222',
            instrumentType: 'jra',
            entityType: 'item',
            action: 'update',
            before: { uraian: 'Sebelum' },
            after: { uraian: 'Sesudah' },
        }])).rejects.toThrow(/audit storage unavailable/);
    });

    it('locks the owning rule-set row before selecting the audit head', async () => {
        const double = transactionDouble();
        await appendRegulatoryEvents(double.tx, [{
            ruleSetId: '22222222-2222-4222-8222-222222222222',
            instrumentType: 'jra',
            entityType: 'rule_set',
            action: 'submit',
            after: { status: 'submitted' },
        }]);

        expect(double.operations().slice(0, 2)).toEqual(['lock-rule-set', 'read-head']);
    });
});
