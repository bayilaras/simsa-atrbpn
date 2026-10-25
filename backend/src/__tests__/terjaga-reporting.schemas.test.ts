import { describe, expect, it } from 'vitest';
import { createArsipTerjagaSchema, updateArsipTerjagaSchema, queryArsipTerjagaSchema } from '../validators/schemas';

const base = { arsipId: '11111111-1111-4111-8111-111111111111', unitKerjaId: 'ditjen', kategoriTerjaga: 'kepulauan' };
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
    it.each(['kepulauan', 'perjanjian_internasional', 'masalah_strategis'])('accepts the ATR/BPN category %s', kategoriTerjaga => {
        expect(createArsipTerjagaSchema.safeParse({ ...base, kategoriTerjaga }).success).toBe(true);
        expect(updateArsipTerjagaSchema.safeParse({ kategoriTerjaga }).success).toBe(true);
    });
    it.each(['kekayaan_negara', 'hak_keperdataan', 'pertanahan', 'batas_wilayah'])('keeps %s searchable but rejects new legacy assignments', kategoriTerjaga => {
        expect(createArsipTerjagaSchema.safeParse({ ...base, kategoriTerjaga }).success).toBe(false);
        expect(updateArsipTerjagaSchema.safeParse({ kategoriTerjaga }).success).toBe(false);
        expect(queryArsipTerjagaSchema.safeParse({ kategoriTerjaga }).success).toBe(true);
    });
});
