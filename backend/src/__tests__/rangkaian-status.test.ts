import { describe, expect, it } from 'vitest';
import {
    deriveRangkaianStatus,
    deriveSuratMasukStatus,
    isRangkaianTerbuka,
    judulRangkaian,
    type RangkaianStatusFacts,
    type SuratMasukStatusFacts,
} from '../services/rangkaian-status';

const base: RangkaianStatusFacts = {
    current: 'aktif',
    asal: 'surat_masuk',
    selesaiManual: false,
    openDisposisi: 0,
    processedDisposisi: 0,
    blockingAnggota: 0,
    approvedTindakLanjut: 0,
};

describe('deriveRangkaianStatus', () => {
    it.each<[string, Partial<RangkaianStatusFacts>, string]>([
        ['diberkaskan terminal', { current: 'diberkaskan', openDisposisi: 3 }, 'diberkaskan'],
        ['digabung terminal', { current: 'digabung', processedDisposisi: 1 }, 'digabung'],
        ['disposisi terbuka membuka kembali selesai manual', { current: 'selesai', selesaiManual: true, openDisposisi: 1 }, 'aktif'],
        ['anggota draft/pending/rejected memblokir', { processedDisposisi: 1, blockingAnggota: 1 }, 'aktif'],
        ['selesai manual tanpa pemblokir', { current: 'selesai', selesaiManual: true }, 'selesai'],
        ['semua disposisi diproses', { processedDisposisi: 2 }, 'selesai'],
        ['tindak lanjut disetujui', { approvedTindakLanjut: 1 }, 'selesai'],
        ['inisiatif tanpa pemblokir', { asal: 'inisiatif' }, 'selesai'],
        ['surat masuk tanpa bukti tetap aktif', {}, 'aktif'],
        ['bukti dibatalkan menurunkan selesai otomatis', { current: 'selesai' }, 'aktif'],
        ['data lama selesai tanpa bukti tetap selesai', { asal: 'data_lama', current: 'selesai' }, 'selesai'],
    ])('%s', (_label, override, expected) => {
        expect(deriveRangkaianStatus({ ...base, ...override })).toBe(expected);
    });
});

describe('deriveSuratMasukStatus', () => {
    const none: SuratMasukStatusFacts = {
        current: 'belum_dibalas',
        approvedReply: false,
        penyelesaian: false,
        selesaiManualNonLegacy: false,
        hasRangkaianEvidence: false,
    };
    it.each<[string, Partial<SuratMasukStatusFacts>, string]>([
        ['balasan/tindak lanjut disetujui', { approvedReply: true, hasRangkaianEvidence: true }, 'sudah_dibalas'],
        ['penyelesaian disposisi', { penyelesaian: true, hasRangkaianEvidence: true }, 'sudah_dibalas'],
        ['selesai manual non data lama', { selesaiManualNonLegacy: true }, 'sudah_dibalas'],
        ['bukti rangkaian dicabut menurunkan status', { current: 'sudah_dibalas', hasRangkaianEvidence: true }, 'belum_dibalas'],
        ['monoton: status impor tanpa bukti rangkaian tidak turun', { current: 'sudah_dibalas' }, 'sudah_dibalas'],
        ['null diperlakukan belum dibalas', { current: null }, 'belum_dibalas'],
        ['data lama selesai tidak memicu sudah dibalas', { selesaiManualNonLegacy: false }, 'belum_dibalas'],
    ])('%s', (_label, override, expected) => {
        expect(deriveSuratMasukStatus({ ...none, ...override })).toBe(expected);
    });
});

describe('isRangkaianTerbuka & judulRangkaian', () => {
    it('hanya aktif dan selesai yang terbuka', () => {
        expect(['aktif', 'selesai', 'diberkaskan', 'digabung'].map((s) => isRangkaianTerbuka(s as never)))
            .toEqual([true, true, false, false]);
    });
    it('memakai perihal, lalu nomor, lalu placeholder (perihal nullable)', () => {
        expect(judulRangkaian({ perihal: '  Undangan rapat  ', nomorSurat: 'B-1' })).toBe('Undangan rapat');
        expect(judulRangkaian({ perihal: null, nomorSurat: 'B-12/PTPP.1/IX/2024' })).toBe('B-12/PTPP.1/IX/2024');
        expect(judulRangkaian({ perihal: '   ', nomorSurat: null })).toBe('(tanpa perihal)');
    });
});
