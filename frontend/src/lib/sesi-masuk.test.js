import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    alamatKembaliAman,
    alamatMasukSetelahSesiDitolak,
    ambilHalamanKembali,
    aturUlangKontakServer,
    catatKontakServer,
    ingatHalamanKembali,
    lamaTanpaKontak,
    lupakanHalamanKembali,
    PESAN_SESI_BERAKHIR,
    sesiBerakhirKarenaTidakAktif,
} from './sesi-masuk'
import { UMUR_DRAF_MAKS_MS } from './draf-isian'

const MENIT = 60 * 1000
const SEKARANG = Date.UTC(2026, 10, 14, 3, 0, 0)

describe('alasan sesi ditolak server', () => {
    beforeEach(() => aturUlangKontakServer())

    it('tidak menyebut tidak ada aktivitas sebelum server pernah menerima sesi', () => {
        expect(lamaTanpaKontak(SEKARANG)).toBe(Infinity)
        expect(sesiBerakhirKarenaTidakAktif(SEKARANG)).toBe(false)
        expect(alamatMasukSetelahSesiDitolak(SEKARANG)).toBe('/login')
    })

    it('menganggap sesi ditutup dengan cara lain bila server menerimanya kurang dari 30 menit lalu', () => {
        catatKontakServer(SEKARANG - 29 * MENIT)
        expect(lamaTanpaKontak(SEKARANG)).toBe(29 * MENIT)
        expect(sesiBerakhirKarenaTidakAktif(SEKARANG)).toBe(false)
        expect(alamatMasukSetelahSesiDitolak(SEKARANG)).toBe('/login')
    })

    it('menjelaskan sesi yang habis karena tidak dipakai setelah 30 menit tanpa kontak', () => {
        catatKontakServer(SEKARANG - 30 * MENIT)
        expect(sesiBerakhirKarenaTidakAktif(SEKARANG)).toBe(true)
        expect(alamatMasukSetelahSesiDitolak(SEKARANG)).toBe('/login?sesi=berakhir')
    })
})

describe('keterangan sesi berakhir', () => {
    it('menyebut isian yang tetap tersimpan sesuai cakupan draf isian', () => {
        expect(PESAN_SESI_BERAKHIR).toMatch(/^Sesi berakhir karena tidak ada aktivitas\. Silakan masuk kembali\. /)
        expect(PESAN_SESI_BERAKHIR).toContain('formulir surat atau dialog Arsipkan Surat')
        expect(PESAN_SESI_BERAKHIR).toContain('di tab ini')
        expect(PESAN_SESI_BERAKHIR).toContain('dapat dipulihkan saat dibuka kembali')
        // Lama penyimpanan yang disebut harus sama dengan umur draf yang sebenarnya.
        expect(PESAN_SESI_BERAKHIR).toContain(`paling lama ${UMUR_DRAF_MAKS_MS / (60 * MENIT)} jam`)
        expect(PESAN_SESI_BERAKHIR).toContain('Berkas yang dipilih perlu dipilih ulang')
    })
})

describe('alamat kembali setelah masuk', () => {
    it.each([
        ['/surat/masuk', '/surat/masuk'],
        ['/surat/masuk/tambah', '/surat/masuk/tambah'],
        ['/arsip/masuk?halaman=2&cari=tanah', '/arsip/masuk?halaman=2&cari=tanah'],
        ['/surat/masuk/sm-1/lembar-disposisi', '/surat/masuk/sm-1/lembar-disposisi'],
        // Hanya jalur dan kueri yang dipakai.
        ['/surat/keluar?status=draf#bagian', '/surat/keluar?status=draf'],
        ['/loginan', '/loginan'],
    ])('menerima alamat dalam aplikasi %s', (alamat, hasil) => {
        expect(alamatKembaliAman(alamat)).toBe(hasil)
    })

    it.each([
        ['alamat situs lain', 'https://contoh-jahat.example/surat'],
        ['alamat tanpa skema', '//contoh-jahat.example/surat'],
        ['tiga garis miring', '///contoh-jahat.example'],
        ['garis miring terbalik', '/\\contoh-jahat.example'],
        ['garis miring terbalik di tengah', '/surat\\masuk'],
        ['skema javascript', 'javascript:alert(1)'],
        ['skema data', 'data:text/html,<b>x</b>'],
        ['tanpa garis miring di depan', 'surat/masuk'],
        ['jalur relatif', '../surat/masuk'],
        ['tab tersembunyi', '/\t/contoh-jahat.example'],
        ['baris baru', '/surat\n/masuk'],
        ['jalur yang menjadi dua garis miring', '/.//contoh-jahat.example'],
        ['halaman masuk', '/login'],
        ['halaman masuk dengan kueri', '/login?sesi=berakhir'],
        ['turunan halaman masuk', '/login/lain'],
        ['halaman masuk lewat titik-titik', '/surat/../login'],
        ['Dashboard, tujuan bawaan', '/'],
        ['Dashboard dengan kueri', '/?x=1'],
        ['teks kosong', ''],
        ['bukan teks', { pathname: '/surat/masuk' }],
        ['null', null],
        ['tidak ada', undefined],
        ['terlalu panjang', `/surat/${'a'.repeat(2100)}`],
    ])('menolak %s', (_nama, alamat) => {
        expect(alamatKembaliAman(alamat)).toBeNull()
    })
})

describe('halaman yang diingat saat sesi berakhir', () => {
    const KUNCI = 'simsa:halaman-kembali'
    const tersimpan = () => JSON.parse(window.sessionStorage.getItem(KUNCI))

    beforeEach(() => window.sessionStorage.clear())
    afterEach(() => vi.restoreAllMocks())

    it('pengguna yang sama kembali ke halaman itu, sekali saja', () => {
        expect(ambilHalamanKembali('u-1')).toBeNull()
        ingatHalamanKembali('/surat/masuk/tambah?dari=daftar')
        expect(tersimpan()).toEqual({ userId: 'u-1', alamat: '/surat/masuk/tambah?dari=daftar' })

        expect(ambilHalamanKembali('u-1')).toBe('/surat/masuk/tambah?dari=daftar')
        expect(ambilHalamanKembali('u-1')).toBeNull()
    })

    it('pengguna lain yang masuk tidak dibawa ke halaman pengguna sebelumnya', () => {
        ambilHalamanKembali('u-1')
        ingatHalamanKembali('/surat/masuk/sm-rahasia')

        expect(ambilHalamanKembali('u-2')).toBeNull()
        expect(tersimpan()).toEqual({ userId: 'u-2', alamat: null })
        // Halaman itu sudah dibuang, juga bagi pengguna pertama.
        expect(ambilHalamanKembali('u-1')).toBeNull()
    })

    it('keluar dengan sengaja melupakan halaman dan pengguna tab ini', () => {
        ambilHalamanKembali('u-1')
        ingatHalamanKembali('/surat/keluar')
        lupakanHalamanKembali()
        expect(window.sessionStorage.getItem(KUNCI)).toBeNull()

        // Setelah keluar, pengalihan ke halaman masuk tidak mengingat apa pun.
        ingatHalamanKembali('/surat/keluar')
        expect(window.sessionStorage.getItem(KUNCI)).toBeNull()
        expect(ambilHalamanKembali('u-1')).toBeNull()
    })

    it('tidak mengingat apa pun bila belum ada pengguna yang masuk di tab ini', () => {
        ingatHalamanKembali('/surat/masuk')
        expect(window.sessionStorage.getItem(KUNCI)).toBeNull()
    })

    it('alamat yang tidak aman tidak menimpa halaman yang sudah diingat', () => {
        ambilHalamanKembali('u-1')
        ingatHalamanKembali('/arsip/masuk')
        ingatHalamanKembali('/login?sesi=berakhir')
        ingatHalamanKembali('//contoh-jahat.example')
        expect(tersimpan()).toEqual({ userId: 'u-1', alamat: '/arsip/masuk' })
    })

    it.each([
        ['alamat situs lain', JSON.stringify({ userId: 'u-1', alamat: 'https://contoh-jahat.example/' })],
        ['alamat tanpa skema', JSON.stringify({ userId: 'u-1', alamat: '//contoh-jahat.example' })],
        ['halaman masuk', JSON.stringify({ userId: 'u-1', alamat: '/login' })],
        ['alamat bukan teks', JSON.stringify({ userId: 'u-1', alamat: { pathname: '/surat/masuk' } })],
        ['pengguna bukan teks', JSON.stringify({ userId: 1, alamat: '/surat/masuk' })],
        ['bukan JSON', '{rusak'],
        ['bukan objek', '"/surat/masuk"'],
    ])('catatan tersimpan yang diubah-ubah (%s) tidak dipakai', (_nama, isi) => {
        window.sessionStorage.setItem(KUNCI, isi)
        expect(ambilHalamanKembali('u-1')).toBeNull()
    })

    it('penyimpanan yang ditolak peramban tidak menggagalkan masuk', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('ditolak') })
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('ditolak') })
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('ditolak') })
        expect(() => ingatHalamanKembali('/surat/masuk')).not.toThrow()
        expect(ambilHalamanKembali('u-1')).toBeNull()
        expect(() => lupakanHalamanKembali()).not.toThrow()
    })
})
