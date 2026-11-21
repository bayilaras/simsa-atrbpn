import { describe, expect, it } from 'vitest'
import { PESAN_KELAS_TERBATAS_PERAN } from '@/lib/kelas-keamanan'
import { formAwalTambah, galatTambahArsip, payloadTambahArsip, pesanGalatTambahArsip } from './tambah-arsip-form'

const lengkap = (extra = {}) => ({
    ...formAwalTambah('lainnya'),
    nomorBerkas: ' SK-001/2025 ',
    tanggalArsip: '2025-03-14',
    uraianBerkas: 'Keputusan tim',
    lokasiFc: 'FC-01',
    lokasiLaci: 'L-02',
    lokasiFolder: 'F-003',
    pernyataan: true,
    ...extra,
})

describe('tambah-arsip-form', () => {
    it('mulai dari jenis tab aktif; jenis tidak dikenal menjadi lainnya', () => {
        expect(formAwalTambah('masuk').jenisArsip).toBe('masuk')
        expect(formAwalTambah('retensi').jenisArsip).toBe('lainnya')
        expect(formAwalTambah().mediaType).toBe('kertas')
    })

    it('mewajibkan identitas, lokasi fisik, tanggal sah, dan pernyataan', () => {
        const galat = galatTambahArsip(formAwalTambah('lainnya'), 'admin_unit')
        expect(Object.keys(galat).sort()).toEqual(
            ['lokasiFc', 'lokasiFolder', 'lokasiLaci', 'nomorBerkas', 'pernyataan', 'tanggalArsip', 'uraianBerkas'].sort(),
        )
        expect(galatTambahArsip(lengkap(), 'admin_unit')).toEqual({})
        expect(galatTambahArsip(lengkap({ tanggalArsip: '2025-02-31' }), 'admin_unit').tanggalArsip).toBe('Tanggal arsip tidak valid.')
        expect(galatTambahArsip(lengkap({ jumlah: '0' }), 'admin_unit').jumlah).toMatch(/1 sampai 10.000/)
        expect(galatTambahArsip(lengkap({ lokasiFc: 'x'.repeat(51) }), 'admin_unit').lokasiFc).toMatch(/maksimal 50/)
    })

    it('menolak kelas di atas plafon peran', () => {
        expect(galatTambahArsip(lengkap({ klasifikasiKeamanan: 'rahasia' }), 'admin_unit').klasifikasiKeamanan).toBe(PESAN_KELAS_TERBATAS_PERAN)
        expect(galatTambahArsip(lengkap({ klasifikasiKeamanan: 'rahasia' }), 'super_admin')).toEqual({})
    })

    it('mengirim isian yang dirapikan dan melewatkan isian kosong', () => {
        expect(payloadTambahArsip(lengkap({ keterangan: '  ', storageLocationId: '' }))).toEqual({
            jenisArsip: 'lainnya',
            nomorBerkas: 'SK-001/2025',
            uraianBerkas: 'Keputusan tim',
            tanggalArsip: '2025-03-14',
            lokasiFc: 'FC-01',
            lokasiLaci: 'L-02',
            lokasiFolder: 'F-003',
            klasifikasiKeamanan: 'biasa',
            jumlah: 1,
            mediaType: 'kertas',
        })
    })

    it('menerjemahkan galat server', () => {
        expect(pesanGalatTambahArsip({ status: 409, message: 'Nomor berkas SK-001 sudah dipakai arsip lain di unit ini untuk tahun 2025.' }))
            .toMatch(/sudah dipakai/)
        expect(pesanGalatTambahArsip({ status: 403, message: 'Klasifikasi keamanan melebihi kewenangan pengguna.' })).toBe(PESAN_KELAS_TERBATAS_PERAN)
        expect(pesanGalatTambahArsip({ status: 400, details: [{ message: 'Nomor berkas wajib diisi' }] })).toBe('Nomor berkas wajib diisi')
    })
})
