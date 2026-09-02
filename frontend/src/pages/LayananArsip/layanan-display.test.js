import { describe, expect, it } from 'vitest';
import { layananUserInitial, layananUserName } from './layanan-display';

describe('layanan arsip user relation contract', () => {
    it('uses the canonical backend user name field', () => {
        const user = { name: 'Arsiparis Utama', nama: 'Nilai lama' };
        expect(layananUserName(user)).toBe('Arsiparis Utama');
        expect(layananUserInitial(user)).toBe('A');
    });

    it('keeps a legacy nama fallback for older records', () => {
        expect(layananUserName({ nama: 'Pemohon Lama' })).toBe('Pemohon Lama');
        expect(layananUserInitial(null)).toBe('?');
    });
});
