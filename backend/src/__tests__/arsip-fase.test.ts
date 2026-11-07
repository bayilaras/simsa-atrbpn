import { describe, expect, it, vi } from 'vitest';
import {
    faseArsip,
    jenisFormulirArsip,
    lengkapiJenisPenyusutanLama,
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

    describe('arsip executed dari penyusutan sebelum migrasi 0035', () => {
        const tereksekusi = (jenis: unknown, over: Partial<BarisFaseArsip> = {}) => baris({
            disposalStatus: 'executed',
            jenisPenyusutanTereksekusi: jenis as BarisFaseArsip['jenisPenyusutanTereksekusi'],
            ...over,
        });

        it.each([
            ['evaluasi aktif', evaluasi('aktif')],
            ['evaluasi belum terverifikasi', evaluasi('aktif', { verified: false })],
            ['tanpa evaluasi', null],
        ])('pemindahan lama tetap inaktif (%s)', (_label, canonicalRetention) => {
            expect(faseArsip(tereksekusi('pemindahan', { canonicalRetention }))).toBe('inaktif');
            expect(faseArsip(tereksekusi('pemindahan', { canonicalRetention, currentRetentionTriggerEventId: null }))).toBe('inaktif');
        });

        it.each([
            ['masih aktif menurut JRA', evaluasi('aktif'), 'aktif'],
            ['belum terverifikasi', evaluasi('kadaluarsa', { verified: false }), 'aktif'],
            ['masa aktif berakhir menurut JRA', evaluasi('inaktif'), 'inaktif'],
            ['kedaluwarsa', evaluasi('kadaluarsa'), 'inaktif'],
        ])('alih media lama mengikuti aturan JRA biasa: %s', (_label, canonicalRetention, expected) => {
            expect(faseArsip(tereksekusi('alih_media', { canonicalRetention }))).toBe(expected);
        });

        it.each([null, undefined, '', 'pemusnahan', 'penyerahan', 'Pemindahan', 'jenis_lain'])(
            'jenis %s tetap selesai',
            (jenis) => {
                expect(faseArsip(tereksekusi(jenis, { canonicalRetention: evaluasi('kadaluarsa') }))).toBe('selesai');
                expect(faseArsip(tereksekusi(jenis, { inactiveTransferredAt: new Date() }))).toBe('selesai');
            },
        );

        it.each(['active', 'approved', 'proposed_serah', null])('jenis diabaikan bila status penyusutan %s', (disposalStatus) => {
            expect(faseArsip(baris({ disposalStatus, jenisPenyusutanTereksekusi: 'pemindahan' }))).toBe('aktif');
            expect(faseArsip(baris({
                disposalStatus, jenisPenyusutanTereksekusi: 'alih_media', canonicalRetention: evaluasi('kadaluarsa'),
            }))).toBe('inaktif');
        });
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
            { id: 'pemindahan-lama', ...baris({ disposalStatus: 'executed', jenisPenyusutanTereksekusi: 'pemindahan' }) },
            { id: 'alih-media-lama', ...baris({ disposalStatus: 'executed', jenisPenyusutanTereksekusi: 'alih_media' }) },
            { id: 'alih-media-lama-inaktif', ...baris({ disposalStatus: 'executed', jenisPenyusutanTereksekusi: 'alih_media', canonicalRetention: evaluasi('inaktif') }) },
            { id: 'pemusnahan-tanpa-jenis', ...baris({ disposalStatus: 'executed', jenisPenyusutanTereksekusi: null, canonicalRetention: evaluasi('aktif') }) },
        ];
        const formulir4 = saringFormulirArsip(rows, 'formulir4').map((row) => row.id);
        const formulir6 = saringFormulirArsip(rows, 'formulir6').map((row) => row.id);
        expect(formulir4).toEqual(['aktif', 'belum-terverifikasi', 'alih-media-lama']);
        expect(formulir6).toEqual(['dipindahkan', 'kedaluwarsa', 'pemindahan-lama', 'alih-media-lama-inaktif']);
        expect(formulir4.filter((id) => formulir6.includes(id))).toEqual([]);
    });

    describe('lengkapiJenisPenyusutanLama', () => {
        it('memanggil pencarian sekali dengan id unik baris executed saja', async () => {
            const cari = vi.fn().mockResolvedValue(new Map([['lama-1', 'pemindahan']]));
            const rows = [
                { id: 'aktif', ...baris() },
                { id: 'lama-1', ...baris({ disposalStatus: 'executed' }) },
                { id: 'lama-1', ...baris({ disposalStatus: 'executed' }) },
                { id: 'musnah', ...baris({ disposalStatus: 'executed' }) },
            ];
            const hasil = await lengkapiJenisPenyusutanLama(rows, cari);
            expect(cari).toHaveBeenCalledExactlyOnceWith(['lama-1', 'musnah']);
            expect(hasil.map((row) => row.jenisPenyusutanTereksekusi)).toEqual([undefined, 'pemindahan', 'pemindahan', null]);
            expect(hasil[0]).toBe(rows[0]);
        });

        it('tidak memanggil pencarian bila tidak ada baris executed', async () => {
            const cari = vi.fn();
            const rows = [{ id: 'aktif', ...baris() }, { id: 'dipindahkan', ...baris({ inactiveTransferredAt: new Date() }) }];
            expect(await lengkapiJenisPenyusutanLama(rows, cari)).toBe(rows);
            expect(await lengkapiJenisPenyusutanLama([], cari)).toEqual([]);
            expect(cari).not.toHaveBeenCalled();
        });
    });

    it('nilai formulirType selain formulir6 tetap berarti Formulir 4', () => {
        expect(jenisFormulirArsip('formulir6')).toBe('formulir6');
        for (const value of ['formulir4', undefined, '', 'formulir7', ['formulir6']]) {
            expect(jenisFormulirArsip(value)).toBe('formulir4');
        }
    });
});
