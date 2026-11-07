import { describe, expect, it } from 'vitest'
import { PESAN_KELAS_TERBATAS_PERAN } from '@/lib/kelas-keamanan'
import {
    PESAN_ALASAN_TERKUNCI,
    PESAN_ARSIP_TIDAK_DAPAT_DIUBAH,
    PESAN_REKONSILIASI_DIKUNCI,
    formAwal,
    kelasPerluPersetujuan,
    payloadPerubahan,
    pesanGalatUbahArsip,
    statusAksiArsip,
    tanggalValid,
    validasiForm,
} from './edit-arsip-form'

const rekod = {
    nomorBerkas: 'B-001/2026',
    uraianBerkas: 'Berkas pengadaan',
    unitPengolah: 'ditjen',
    kurunWaktu: '2026-01-01 s/d 2026-12-31',
    tanggalArsip: '2026-03-04T00:00:00.000Z',
    nomorItem: '1',
    uraianItem: 'Surat permohonan',
    tingkatPerkembangan: 'asli',
    jumlah: 2,
    mediaType: 'Kertas',
    lokasiFc: 'FC-01',
    lokasiLaci: 'L-02',
    lokasiFolder: 'F-003',
    klasifikasiKeamanan: null,
    personInCharge: null,
    keterangan: null,
}

describe('formAwal', () => {
    it('memetakan nilai lama ke opsi baku tanpa dianggap berubah', () => {
        const awal = formAwal(rekod)
        expect(awal).toMatchObject({
            modeKurun: 'tanggal',
            kurunDari: '2026-01-01',
            kurunSampai: '2026-12-31',
            tanggalArsip: '2026-03-04',
            unitPengolah: 'Ditjen',
            tingkatPerkembangan: 'Asli',
            mediaType: 'kertas',
            jumlah: '2',
            klasifikasiKeamanan: 'biasa',
            personInCharge: '',
        })
        expect(payloadPerubahan(awal, awal)).toEqual({})
    })

    it('kurun waktu di luar format registrasi tetap berupa teks bebas', () => {
        const awal = formAwal({ ...rekod, kurunWaktu: 'Januari s/d Maret 2020' })
        expect(awal.modeKurun).toBe('teks')
        expect(awal.kurunTeks).toBe('Januari s/d Maret 2020')
        expect(payloadPerubahan({ ...awal, kurunTeks: ' 2020 ' }, awal)).toEqual({ kurunWaktu: '2020' })
    })
})

describe('payloadPerubahan', () => {
    it('hanya field yang berubah, sudah di-trim, jumlah sebagai angka', () => {
        const awal = formAwal(rekod)
        const form = { ...awal, nomorBerkas: '  B-002/2026 ', jumlah: '3', kurunSampai: '2027-01-31', lokasiFc: 'FC-01 ' }
        expect(payloadPerubahan(form, awal)).toEqual({
            nomorBerkas: 'B-002/2026',
            kurunWaktu: '2026-01-01 s/d 2027-01-31',
            jumlah: 3,
        })
    })
})

describe('validasiForm', () => {
    const awal = formAwal(rekod)

    it('field wajib dan lokasi fisik tidak boleh dikosongkan', () => {
        const galat = validasiForm({ ...awal, nomorBerkas: ' ', lokasiLaci: '', mediaType: '' }, awal, 'admin_unit')
        expect(galat).toEqual({
            nomorBerkas: 'Nomor Berkas wajib diisi.',
            mediaType: 'Media wajib diisi.',
            lokasiLaci: 'No. Laci wajib diisi.',
        })
    })

    it('rekod lama yang kosong boleh tetap kosong', () => {
        const kosong = formAwal({ ...rekod, lokasiFc: '', unitPengolah: null })
        expect(validasiForm({ ...kosong, keterangan: 'Koreksi' }, kosong, 'admin_unit')).toEqual({})
    })

    it('batas panjang, jumlah, tanggal, dan kurun waktu', () => {
        const galat = validasiForm({
            ...awal,
            nomorBerkas: 'x'.repeat(101),
            jumlah: '10001',
            tanggalArsip: '',
            kurunDari: '2026-05-01',
            kurunSampai: '2026-04-01',
        }, awal, 'admin_unit')
        expect(galat.nomorBerkas).toMatch(/maksimal 100 karakter/)
        expect(galat.jumlah).toBe('Jumlah harus bilangan bulat 1 sampai 10.000.')
        expect(galat.tanggalArsip).toBe('Tanggal arsip tidak boleh dikosongkan.')
        expect(galat.kurunWaktu).toMatch(/tidak boleh sebelum tanggal awal/)
        expect(validasiForm({ ...awal, jumlah: '1.5' }, awal, 'admin_unit').jumlah).toBeDefined()
        expect(validasiForm({ ...awal, kurunSampai: '' }, awal, 'admin_unit').kurunWaktu).toMatch(/awal dan akhir/)
    })

    it('kelas di atas kewenangan peran ditolak sebelum dikirim', () => {
        expect(validasiForm({ ...awal, klasifikasiKeamanan: 'rahasia' }, awal, 'admin_unit'))
            .toEqual({ klasifikasiKeamanan: PESAN_KELAS_TERBATAS_PERAN })
        expect(validasiForm({ ...awal, klasifikasiKeamanan: 'rahasia' }, awal, 'super_admin')).toEqual({})
    })
})

describe('pembantu lain', () => {
    it('tanggalValid sama ketatnya dengan dateSchema backend', () => {
        expect(tanggalValid('2026-02-28')).toBe(true)
        expect(tanggalValid('2026-02-30')).toBe(false)
        expect(tanggalValid('28/02/2026')).toBe(false)
    })

    it('kelasPerluPersetujuan untuk Terbatas ke atas', () => {
        expect(kelasPerluPersetujuan('biasa')).toBe(false)
        expect(kelasPerluPersetujuan(undefined)).toBe(false)
        expect(kelasPerluPersetujuan('terbatas')).toBe(true)
        expect(kelasPerluPersetujuan('sangat_rahasia')).toBe(true)
    })

    it('pesanGalatUbahArsip memetakan plafon kelas dan 404', () => {
        expect(pesanGalatUbahArsip({ status: 403, message: 'Klasifikasi keamanan melebihi kewenangan pengguna' }))
            .toBe(PESAN_KELAS_TERBATAS_PERAN)
        expect(pesanGalatUbahArsip({ status: 404, message: 'Arsip not found' })).toBe(PESAN_ARSIP_TIDAK_DAPAT_DIUBAH)
        expect(pesanGalatUbahArsip({ status: 409, message: 'ConflictError', data: { message: 'Arsip bersifat immutable.' } }))
            .toBe('Arsip bersifat immutable.')
        expect(pesanGalatUbahArsip({ status: 400, message: 'Validation failed', details: [{ message: 'Tanggal tidak valid' }] }))
            .toBe('Tanggal tidak valid')
        expect(pesanGalatUbahArsip({})).toBe('Gagal memperbarui metadata arsip.')
    })
})

describe('statusAksiArsip', () => {
    const aktif = { disposalStatus: 'active', legalHold: false, disposalBatchId: null }

    it('hak aksi dari server menang atas keadaan rekod', () => {
        const dikunci = { ...aktif, aksiDiizinkan: [], alasanTerkunci: 'tidak_berwenang' }
        expect(statusAksiArsip(dikunci)).toEqual({ boleh: false, alasan: PESAN_ALASAN_TERKUNCI.tidak_berwenang })
        const dibuka = { ...aktif, legalHold: true, aksiDiizinkan: ['ubah_metadata', 'rekonsiliasi_aturan'], alasanTerkunci: null }
        expect(statusAksiArsip(dibuka)).toEqual({ boleh: true, alasan: '' })
        expect(statusAksiArsip(dibuka, 'rekonsiliasi_aturan')).toEqual({ boleh: true, alasan: '' })
    })

    it('perlu_izin_kelola menyebut halaman, mode saat ini, dan jalan keluarnya', () => {
        const arsip = {
            ...aktif,
            aksiDiizinkan: [],
            alasanTerkunci: 'perlu_izin_kelola',
            izinAkses: { mode: 'download', berlakuSampai: '2026-12-01T03:00:00.000Z' },
        }
        const { boleh, alasan } = statusAksiArsip(arsip)
        expect(boleh).toBe(false)
        expect(alasan).toContain('Persetujuan Akses Rekod')
        expect(alasan).toContain('"Tayang dan unduh"')
        expect(alasan).toContain('"Tayang dan kelola"')
        expect(alasan).toMatch(/Super Admin mencabutnya atau tunggu sampai masa berlakunya berakhir/)
        expect(alasan).toContain(new Date('2026-12-01T03:00:00.000Z').toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }))
        expect(alasan).not.toContain('Izin Akses Rekod')
        // Kunci yang sama untuk rekonsiliasi, bukan kalimat legal hold.
        expect(statusAksiArsip(arsip, 'rekonsiliasi_aturan').alasan).toBe(alasan)

        const tayang = statusAksiArsip({ ...arsip, izinAkses: { mode: 'view', berlakuSampai: null } }).alasan
        expect(tayang).toContain('"Tayang saja"')
        expect(tayang).not.toContain('berlaku sampai')
    })

    it('kode tak dikenal jatuh ke tidak_berwenang', () => {
        expect(statusAksiArsip({ ...aktif, aksiDiizinkan: [], alasanTerkunci: 'kode_baru' }).alasan)
            .toBe(PESAN_ALASAN_TERKUNCI.tidak_berwenang)
        expect(statusAksiArsip({ ...aktif, aksiDiizinkan: [], alasanTerkunci: '__proto__' }).alasan)
            .toBe(PESAN_ALASAN_TERKUNCI.tidak_berwenang)
        expect(statusAksiArsip({ ...aktif, aksiDiizinkan: ['rekonsiliasi_aturan'], alasanTerkunci: null }))
            .toEqual({ boleh: false, alasan: PESAN_ALASAN_TERKUNCI.tidak_berwenang })
    })

    it('rekonsiliasi_aturan diperiksa terpisah dari ubah_metadata', () => {
        const arsip = { ...aktif, aksiDiizinkan: ['ubah_metadata'], alasanTerkunci: null }
        expect(statusAksiArsip(arsip, 'ubah_metadata').boleh).toBe(true)
        expect(statusAksiArsip(arsip, 'rekonsiliasi_aturan').boleh).toBe(false)
        const ditahan = { ...aktif, aksiDiizinkan: [], alasanTerkunci: 'legal_hold' }
        expect(statusAksiArsip(ditahan).alasan).toBe(PESAN_ALASAN_TERKUNCI.legal_hold)
        expect(statusAksiArsip(ditahan, 'rekonsiliasi_aturan').alasan).toBe(PESAN_REKONSILIASI_DIKUNCI)
    })

    it('tanpa aksiDiizinkan memakai keadaan rekod seperti sebelumnya', () => {
        expect(statusAksiArsip(aktif)).toEqual({ boleh: true, alasan: '' })
        expect(statusAksiArsip(aktif, 'rekonsiliasi_aturan')).toEqual({ boleh: true, alasan: '' })
        expect(statusAksiArsip({ ...aktif, disposalStatus: 'executed' }).alasan)
            .toBe('Metadata dikunci karena penyusutan arsip ini sudah dilaksanakan.')
        expect(statusAksiArsip({ ...aktif, legalHold: true }).alasan)
            .toBe('Metadata dikunci karena arsip sedang dalam legal hold.')
        expect(statusAksiArsip({ ...aktif, disposalBatchId: 'batch-1' }).alasan)
            .toBe('Metadata dikunci karena arsip sedang dalam proses penyusutan.')
        expect(statusAksiArsip({ ...aktif, disposalStatus: 'proposed_musnah' }, 'rekonsiliasi_aturan'))
            .toEqual({ boleh: false, alasan: PESAN_REKONSILIASI_DIKUNCI })
    })
})
