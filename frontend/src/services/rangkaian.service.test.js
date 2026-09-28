import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }))
vi.mock('./api', () => ({ default: apiMock }))

import rangkaianService from './rangkaian.service'
import { distributionService } from './distribution.service'

beforeEach(() => {
    vi.clearAllMocks()
    apiMock.get.mockResolvedValue({ success: true, data: { ok: true } })
    apiMock.post.mockResolvedValue({ success: true, data: { ok: true } })
    apiMock.put.mockResolvedValue({ success: true, data: { ok: true } })
})

it('memuat rangkaian dari endpoint baca', async () => {
    apiMock.get.mockResolvedValue({ success: true, data: { rangkaian: { id: 'r1' } } })
    await expect(rangkaianService.getById('r1')).resolves.toEqual({ rangkaian: { id: 'r1' } })
    expect(apiMock.get).toHaveBeenCalledWith('/api/rangkaian/r1')
})

it('memuat rangkaian per surat dan meneruskan null untuk surat tunggal', async () => {
    apiMock.get.mockResolvedValue({ success: true, data: null })
    await expect(rangkaianService.getBySurat('surat_keluar', 's1')).resolves.toBeNull()
    expect(apiMock.get).toHaveBeenCalledWith('/api/rangkaian/by-surat/surat_keluar/s1')
})

it('menolak jenis surat tak dikenal sebelum memanggil API', async () => {
    await expect(rangkaianService.getBySurat('arsip', 'x')).rejects.toThrow(/jenis surat/i)
    expect(apiMock.get).not.toHaveBeenCalled()
})

describe('rangkaianService P3', () => {
    it('lacak meneruskan parameter dan AbortSignal', async () => {
        const controller = new AbortController()
        await rangkaianService.lacak({ q: 'B-12', mode: 'referensi', jenis: 'surat_keluar' }, { signal: controller.signal })
        expect(apiMock.get).toHaveBeenCalledWith('/api/rangkaian/lacak',
            { q: 'B-12', mode: 'referensi', tahun: undefined, jenis: 'surat_keluar', limit: 8 }, { signal: controller.signal })
    })

    it.each([
        ['tandaiSelesai', ['rs-1', 'Catatan penyelesaian'], 'post', ['/api/rangkaian/rs-1/selesai', { catatan: 'Catatan penyelesaian' }]],
        ['bukaKembali', ['rs-1', 'Ada surat susulan'], 'post', ['/api/rangkaian/rs-1/buka-kembali', { alasan: 'Ada surat susulan' }]],
        ['berkaskan', ['rs-1', { unitPengolahId: 'dir_bppt', klasifikasiItemId: 7 }], 'post', ['/api/rangkaian/rs-1/berkaskan', { unitPengolahId: 'dir_bppt', klasifikasiItemId: 7, konfirmasi: true }]],
        ['ubahUnitPengolah', ['rs-1', 'dir_ptep'], 'put', ['/api/rangkaian/rs-1/unit-pengolah', { unitPengolahId: 'dir_ptep' }]],
        ['gabung', ['rs-1', { sumberId: 'rs-2', alasan: 'TU lupa referensi' }], 'post', ['/api/rangkaian/rs-1/gabung', { sumberId: 'rs-2', alasan: 'TU lupa referensi' }]],
        ['batalRelasi', ['rel-1', 'Salah tautan surat'], 'post', ['/api/rangkaian/relasi/rel-1/batal', { alasan: 'Salah tautan surat' }]],
        ['tutupDisposisi', ['d-1', 'Target tidak memproses'], 'post', ['/api/rangkaian/disposisi/d-1/tutup', { alasan: 'Target tidak memproses' }]],
        ['ajukanAkses', ['a-1', 'Menindaklanjuti disposisi TU'], 'post', ['/api/rangkaian/anggota/a-1/ajukan-akses', { purpose: 'Menindaklanjuti disposisi TU', accessMode: 'view' }]],
    ])('%s memanggil endpoint yang benar', async (method, args, verb, expected) => {
        await rangkaianService[method](...args)
        expect(apiMock[verb]).toHaveBeenCalledWith(...expected)
    })
})

describe('distributionService P3', () => {
    it('distributeMany mengirim targets dan instruksi', async () => {
        await distributionService.distributeMany({ suratMasukId: 's1', sourceUnitId: 'sesditjen', targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }], instruksi: 'Segera' })
        expect(apiMock.post).toHaveBeenCalledWith('/api/distributions', { suratMasukId: 's1', sourceUnitId: 'sesditjen', targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }], instruction: 'Segera' })
    })

    it('process mengirim penyelesaian', async () => {
        await distributionService.process('d1', 'dir_bppt', { catatanPenyelesaian: 'Sudah dikoordinasikan' })
        expect(apiMock.put).toHaveBeenCalledWith('/api/distributions/d1/process?unitKerjaId=dir_bppt', { catatanPenyelesaian: 'Sudah dikoordinasikan' })
    })
})

describe('rangkaianService P5', () => {
    it('memanggil endpoint Koreksi Berkas dan Tutup massal yang tepat', async () => {
        await rangkaianService.getKoreksiBerkas('r 1')
        await rangkaianService.ajukanKoreksiBerkas('r1', { alasan: 'x' })
        await rangkaianService.putuskanKoreksiBerkas('k1', { keputusan: 'setuju' })
        await rangkaianService.getRingkasanDataLama()
        expect(await rangkaianService.tutupMassalDataLama({ dryRun: true })).toEqual({ ok: true })
        expect(apiMock.get.mock.calls).toEqual([['/api/rangkaian/r%201/koreksi-berkas'], ['/api/rangkaian/data-lama/ringkasan']])
        expect(apiMock.post.mock.calls).toEqual([
            ['/api/rangkaian/r1/koreksi-berkas', { alasan: 'x' }],
            ['/api/rangkaian/koreksi-berkas/k1/putuskan', { keputusan: 'setuju' }],
            ['/api/rangkaian/data-lama/tutup-massal', { dryRun: true }],
        ])
    })
})
