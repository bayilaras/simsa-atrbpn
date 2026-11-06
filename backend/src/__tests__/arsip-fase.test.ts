import { describe, expect, it } from 'vitest';
import {
    faseArsip,
    jenisFormulirArsip,
    masaAktifBerakhir,
    saringFormulirArsip,
    type BarisFaseArsip,
} from '../services/arsip-fase';

const evaluasi = (status: string, extra: Record<string, unknown> = {}) => ({
    verified: true, calculationEligible: true, status, ...extra,
}) as BarisFaseArsip['canonicalRetention'];

const baris = (over: Partial<BarisFaseArsip> = {}): BarisFaseArsip => ({
    disposalStatus: 'active',
    inactiveTransferredAt: null,
    currentRetentionTriggerEventId: 'pemicu-1',
    canonicalRetention: evaluasi('aktif'),
    ...over,
});

describe('fase arsip untuk Formulir 4 dan Formulir 6', () => {
    it.each([
        ['sudah dipindahkan ke penyimpanan inaktif', baris({ inactiveTransferredAt: new Date('2026-01-05T00:00:00Z'), canonicalRetention: null }), 'inaktif'],
        ['dipindahkan walau evaluasinya masih aktif', baris({ inactiveTransferredAt: '2026-01-05T00:00:00Z' }), 'inaktif'],
        ['masa aktif berakhir menurut JRA terverifikasi', baris({ canonicalRetention: evaluasi('inaktif') }), 'inaktif'],
        ['akan kedaluwarsa', baris({ canonicalRetention: evaluasi('akan_kadaluarsa') }), 'inaktif'],
        ['sudah kedaluwarsa', baris({ canonicalRetention: evaluasi('kadaluarsa') }), 'inaktif'],
        ['status inaktif tetapi JRA belum terverifikasi', baris({ canonicalRetention: evaluasi('inaktif', { verified: false }) }), 'aktif'],
        ['status inaktif tetapi durasi JRA tidak dapat dihitung', baris({ canonicalRetention: evaluasi('inaktif', { calculationEligible: false }) }), 'aktif'],
        ['status inaktif tanpa peristiwa pemicu', baris({ currentRetentionTriggerEventId: null, canonicalRetention: evaluasi('kadaluarsa') }), 'aktif'],
        ['masih dalam masa aktif', baris({ canonicalRetention: evaluasi('aktif') }), 'aktif'],
        ['akan memasuki masa inaktif', baris({ canonicalRetention: evaluasi('akan_inaktif') }), 'aktif'],
        ['belum punya evaluasi retensi', baris({ canonicalRetention: undefined }), 'aktif'],
        ['status penyusutan kosong (data lama)', baris({ disposalStatus: null }), 'aktif'],
        ['penyusutan sudah dieksekusi', baris({ disposalStatus: 'executed', canonicalRetention: evaluasi('aktif') }), 'selesai'],
        ['dieksekusi setelah dipindahkan dan kedaluwarsa', baris({ disposalStatus: 'executed', inactiveTransferredAt: new Date(), canonicalRetention: evaluasi('kadaluarsa') }), 'selesai'],
    ])('%s', (_label, row, expected) => {
        expect(faseArsip(row)).toBe(expected);
    });

    it('masaAktifBerakhir menuntut evaluasi terverifikasi dan dapat dihitung', () => {
        expect(masaAktifBerakhir(evaluasi('inaktif'))).toBe(true);
        expect(masaAktifBerakhir(evaluasi('inaktif', { verified: false }))).toBe(false);
        expect(masaAktifBerakhir(evaluasi('inaktif', { calculationEligible: false }))).toBe(false);
        expect(masaAktifBerakhir(evaluasi('belum_ditentukan'))).toBe(false);
        expect(masaAktifBerakhir(null)).toBe(false);
    });

    it('setiap arsip masuk paling banyak satu formulir dan arsip tereksekusi tidak masuk keduanya', () => {
        const rows = [
            { id: 'aktif', ...baris() },
            { id: 'dipindahkan', ...baris({ inactiveTransferredAt: new Date() }) },
            { id: 'kedaluwarsa', ...baris({ canonicalRetention: evaluasi('kadaluarsa') }) },
            { id: 'belum-terverifikasi', ...baris({ canonicalRetention: evaluasi('inaktif', { verified: false }) }) },
            { id: 'dimusnahkan', ...baris({ disposalStatus: 'executed', canonicalRetention: evaluasi('kadaluarsa') }) },
        ];
        const formulir4 = saringFormulirArsip(rows, 'formulir4').map((row) => row.id);
        const formulir6 = saringFormulirArsip(rows, 'formulir6').map((row) => row.id);
        expect(formulir4).toEqual(['aktif', 'belum-terverifikasi']);
        expect(formulir6).toEqual(['dipindahkan', 'kedaluwarsa']);
        expect(formulir4.filter((id) => formulir6.includes(id))).toEqual([]);
    });

    it('nilai formulirType selain formulir6 tetap berarti Formulir 4', () => {
        expect(jenisFormulirArsip('formulir6')).toBe('formulir6');
        for (const value of ['formulir4', undefined, '', 'formulir7', ['formulir6']]) {
            expect(jenisFormulirArsip(value)).toBe('formulir4');
        }
    });
});
