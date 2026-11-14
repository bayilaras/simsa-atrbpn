import { describe, expect, it } from 'vitest';
import {
    catatanNomorUrutImpor, nomorUrutSumber, pesanNomorUrutTerpakai, tahunUrutanBaru,
} from '../services/surat-nomor-urut.js';

describe('nomor urut dari sumber impor', () => {
    it.each([['12', 12], [' 007 ', 7], ['999999', 999999], ['1', 1]])('membaca %j sebagai %d', (sel, angka) => {
        expect(nomorUrutSumber(sel)).toBe(angka);
    });

    it.each(['', '0', '-3', '12a', '1.000', '1,5', '1000000', 'No. 4', undefined, null])('tidak memakai %j', sel => {
        expect(nomorUrutSumber(sel as string | undefined)).toBeNull();
    });

    it('melaporkan nomor sumber yang sudah dipakai atau tidak dapat dipakai, dengan nomor penggantinya', () => {
        expect(catatanNomorUrutImpor('masuk', '12', 57)).toBe('Nomor agenda sumber 12 sudah dipakai; diberi nomor 57.');
        expect(catatanNomorUrutImpor('keluar', '012', 57)).toBe('Nomor urut sumber 12 sudah dipakai; diberi nomor 57.');
        expect(catatanNomorUrutImpor('masuk', '12a', 57)).toBe('Nomor agenda sumber "12a" bukan angka 1 sampai 999999; diberi nomor 57.');
        expect(catatanNomorUrutImpor('masuk', 'x'.repeat(40), 3)).toBe(`Nomor agenda sumber "${'x'.repeat(19)}…" bukan angka 1 sampai 999999; diberi nomor 3.`);
    });

    it('tidak memberi catatan bila nomor sumber tersimpan, sumber tanpa nomor, atau nomor tersimpan tidak diketahui', () => {
        expect(catatanNomorUrutImpor('masuk', '12', 12)).toBeUndefined();
        expect(catatanNomorUrutImpor('masuk', '', 57)).toBeUndefined();
        expect(catatanNomorUrutImpor('masuk', '12', undefined)).toBeUndefined();
    });

    it('pesan 409 formulir menyebut nomor, tahun, dan nama isiannya', () => {
        expect(pesanNomorUrutTerpakai('keluar', 120, 2026)).toBe('No. Urut 120 tahun 2026 sudah dipakai surat lain di unit ini. '
            + 'Nomor surat yang sudah dihapus juga tidak dapat dipakai ulang. Kosongkan No. Urut untuk nomor otomatis atau isi nomor lain.');
    });
});

describe('tahun urutan saat tanggal surat diubah', () => {
    it('pindah bila tanggal baru jatuh di tahun lain dari kolom tahun', () => {
        expect(tahunUrutanBaru({ tahun: 2026, tanggalSurat: '2026-01-05' }, '2025-12-30')).toBe(2025);
    });

    it('tetap bila tanggal tidak berubah, tidak dikirim, atau masih di tahun yang sama', () => {
        expect(tahunUrutanBaru({ tahun: 2026, tanggalSurat: '2026-01-05' }, '2026-12-31')).toBeNull();
        expect(tahunUrutanBaru({ tahun: 2026, tanggalSurat: '2026-01-05' }, undefined)).toBeNull();
        // Data lama yang tahunnya tidak cocok dengan tanggalnya tidak dipindah oleh suntingan lain.
        expect(tahunUrutanBaru({ tahun: 2025, tanggalSurat: '2026-01-05' }, '2026-01-05')).toBeNull();
    });
});
