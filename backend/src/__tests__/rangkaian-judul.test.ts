// backend/src/__tests__/rangkaian-judul.test.ts
import { describe, expect, it } from 'vitest';
import { judulRangkaianTampil } from '../services/rangkaian-judul';

describe('judulRangkaianTampil', () => {
    it('mengganti judul dengan placeholder bila induk tersamar, apa pun isi judul tersimpan', () => {
        expect(judulRangkaianTampil('RS-2026-000001', 'Perihal rahasia anggaran', true)).toBe('Rangkaian RS-2026-000001 (Dikecualikan)');
    });
    it('memakai judul tersimpan bila induk terbaca, dengan cadangan kode bila kosong', () => {
        expect(judulRangkaianTampil('RS-2026-000002', '  Undangan rapat  ', false)).toBe('Undangan rapat');
        expect(judulRangkaianTampil('RS-2026-000003', '', false)).toBe('Rangkaian RS-2026-000003');
        expect(judulRangkaianTampil('RS-2026-000004', null, false)).toBe('Rangkaian RS-2026-000004');
    });
});
