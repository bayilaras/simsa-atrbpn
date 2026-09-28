import { beforeEach, describe, expect, it, vi } from 'vitest';

// C-M5: `ajukan` memeriksa lalu menyisipkan. requestViaRangkaian bersamaan
// (target yang sama, surat yang sama, tanpa kunci SM) dapat menyisipkan grant
// pending di antaranya; INSERT wajib ON CONFLICT DO NOTHING (indeks unik parsial
// record_access_grants_one_pending_idx/_one_approved_idx) agar transaksi
// distribute tidak batal dengan 23505 → 500.

const audit = vi.hoisted(() => ({ logActionOrThrow: vi.fn() }));
vi.mock('../services/audit-log.service.js', () => ({ default: audit }));

const { disposisiGrantService } = await import('../services/rangkaian/disposisi-grant.service');

function rantai(hasil: unknown) {
    const chain: any = new Proxy({}, {
        get(_t, prop) {
            if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(hasil);
            return () => chain;
        },
    });
    return chain;
}

const input = {
    distribusiId: 'd-1', suratMasukId: 'sm-1', suratUnitKerjaId: 'sesditjen', classification: 'rahasia',
    targetUnitId: 'dir_bppt', requesterId: 'u-tu', rangkaianKode: 'RS-2026-000001',
};

describe('disposisiGrantService.ajukan (C-M5)', () => {
    let onConflictDoNothing: ReturnType<typeof vi.fn>;
    let tx: any;

    beforeEach(() => {
        audit.logActionOrThrow.mockReset().mockResolvedValue(undefined);
        onConflictDoNothing = vi.fn();
        tx = {
            execute: vi.fn(async () => ({ rows: [{ id: 'u-admin-1' }, { id: 'u-admin-2' }] })),
            select: vi.fn(() => rantai([])),
            insert: vi.fn(() => ({
                values: () => ({
                    onConflictDoNothing: (...args: unknown[]) => {
                        onConflictDoNothing(...args);
                        const ke = onConflictDoNothing.mock.calls.length;
                        // Admin pertama kalah balapan (grant bersamaan sudah ada), kedua berhasil.
                        return { returning: async () => (ke === 1 ? [] : [{ id: 'g-2' }]) };
                    },
                }),
            })),
        };
    });

    it('INSERT memakai ON CONFLICT DO NOTHING; baris yang bentrok dilewati tanpa audit dan tanpa galat', async () => {
        const dibuat = await disposisiGrantService.ajukan(tx, input, { userId: 'u-tu' });
        expect(onConflictDoNothing).toHaveBeenCalledTimes(2);
        expect(dibuat).toEqual(['g-2']);
        expect(audit.logActionOrThrow).toHaveBeenCalledTimes(1);
        expect(audit.logActionOrThrow).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'g-2', action: 'request_access' }), tx);
    });
});
