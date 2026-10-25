// backend/src/__tests__/rangkaian-status-p3.test.ts
import { describe, expect, it } from 'vitest';
import { deriveRangkaianStatus, deriveStatusAlur, type RangkaianStatusFacts } from '../services/rangkaian-status';

const dasar: RangkaianStatusFacts = {
    current: 'aktif', asal: 'surat_masuk', selesaiManual: false, openDisposisi: 0,
    processedDisposisi: 0, blockingAnggota: 0, approvedTindakLanjut: 0,
};

describe('fakta suratMasukBelumDitangani (P3)', () => {
    it.each<[string, Partial<RangkaianStatusFacts>, string]>([
        ['surat masuk baru menahan rangkaian aktif walau disposisi lama processed', { current: 'selesai', processedDisposisi: 1, suratMasukBelumDitangani: 1 }, 'aktif'],
        ['rangkaian inisiatif dengan surat masuk merujuk yang belum ditangani tetap aktif', { asal: 'inisiatif', suratMasukBelumDitangani: 1 }, 'aktif'],
        ['selesai manual tetap selesai', { current: 'selesai', selesaiManual: true, suratMasukBelumDitangani: 1 }, 'selesai'],
        ['data_lama tidak dibuka oleh fakta ini', { current: 'selesai', asal: 'data_lama', suratMasukBelumDitangani: 1 }, 'selesai'],
        ['tanpa fakta baru perilaku P1 tetap', { processedDisposisi: 1 }, 'selesai'],
        ['nol surat belum ditangani sama dengan tanpa fakta', { processedDisposisi: 1, suratMasukBelumDitangani: 0 }, 'selesai'],
    ])('%s', (_nama, patch, hasil) => {
        expect(deriveRangkaianStatus({ ...dasar, ...patch })).toBe(hasil);
    });
});

describe('deriveStatusAlur', () => {
    it.each([
        [{ rangkaianStatus: null, adaDisposisi: false, adaTindakLanjut: false }, 'terdaftar'],
        [{ rangkaianStatus: 'aktif', adaDisposisi: true, adaTindakLanjut: false }, 'didisposisikan'],
        [{ rangkaianStatus: 'aktif', adaDisposisi: true, adaTindakLanjut: true }, 'ditindaklanjuti'],
        [{ rangkaianStatus: 'selesai', adaDisposisi: true, adaTindakLanjut: true }, 'selesai'],
        [{ rangkaianStatus: 'diberkaskan', adaDisposisi: false, adaTindakLanjut: false }, 'diberkaskan'],
    ] as const)('%j → %s', (input, hasil) => {
        expect(deriveStatusAlur(input as any)).toBe(hasil);
    });
});
