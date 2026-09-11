import { describe, expect, it } from 'vitest';
import { createArsipTerjagaSchema, updateArsipTerjagaSchema } from '../validators/schemas';

const base = { arsipId: '11111111-1111-4111-8111-111111111111', unitKerjaId: 'ditjen', kategoriTerjaga: 'pertanahan' };
describe('terjaga reporting cannot be asserted through metadata', () => {
    it.each(['statusKepatuhan', 'statusPelaporan', 'nomorLaporanANRI', 'tanggalPelaporan'])(
        'rejects direct creation/update of %s', (field) => {
            const values: Record<string, string> = { statusKepatuhan: 'patuh', statusPelaporan: 'terverifikasi', nomorLaporanANRI: '123', tanggalPelaporan: '2026-09-11' };
            expect(createArsipTerjagaSchema.safeParse({ ...base, [field]: values[field] }).success).toBe(false);
            expect(updateArsipTerjagaSchema.safeParse({ catatan: 'Catatan', [field]: values[field] }).success).toBe(false);
        },
    );
    it('keeps metadata updates free of system-state defaults', () => {
        expect(updateArsipTerjagaSchema.parse({ catatan: 'Catatan' })).toEqual({ catatan: 'Catatan' });
    });
});
