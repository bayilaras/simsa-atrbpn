import { describe, expect, it } from 'vitest'
import { fotoProfilAman } from './foto-profil'

describe('fotoProfilAman', () => {
    it.each([
        'https://lh3.googleusercontent.com/a/ACg8ocI-sintetis=s96-c',
        'https://lh5.googleusercontent.com/a-/sintetis',
    ])('menerima foto akun Google %s', (alamat) => {
        expect(fotoProfilAman(alamat)).toBe(alamat)
    })

    it.each([
        ['kosong', ''],
        ['bukan teks', null],
        ['tak terdefinisi', undefined],
        ['host lain', 'https://example.test/foto.jpg'],
        ['http', 'http://lh3.googleusercontent.com/a/foto'],
        ['alamat dalam aplikasi', '/api/files/surat_masuk/1?download=1'],
        ['alamat tanpa skema', '//lh3.googleusercontent.com/a/foto'],
        ['host mirip', 'https://lh3.googleusercontent.com.example.test/a/foto'],
        ['subdomain lain', 'https://evil.googleusercontent.com/a/foto'],
        ['berkredensial', 'https://pengguna@lh3.googleusercontent.com/a/foto'],
        ['berport', 'https://lh3.googleusercontent.com:8443/a/foto'],
        ['data', 'data:image/png;base64,AAAA'],
        ['skema lain', 'javascript:alert(1)'],
        ['terlalu panjang', `https://lh3.googleusercontent.com/a/${'f'.repeat(2048)}`],
    ])('menolak alamat %s', (_label, alamat) => {
        expect(fotoProfilAman(alamat)).toBeUndefined()
    })
})
