import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { COMMON_PASSWORDS, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, newPasswordError, passwordRuleError } from './password-policy'

const backend = readFileSync(path.resolve(import.meta.dirname, '../../../backend/src/config/password-policy.ts'), 'utf8')

describe('aturan kata sandi baru', () => {
    it('sama dengan aturan server', () => {
        expect(Number(backend.match(/NEW_PASSWORD_MIN_LENGTH = (\d+)/)[1])).toBe(PASSWORD_MIN_LENGTH)
        expect(Number(backend.match(/CREDENTIAL_PASSWORD_MAX_LENGTH = (\d+)/)[1])).toBe(PASSWORD_MAX_LENGTH)
        const daftar = backend.match(/COMMON_PASSWORDS[^=]*= \[([^\]]*)\]/)[1]
        expect([...daftar.matchAll(/'([^']+)'/g)].map(match => match[1])).toEqual(COMMON_PASSWORDS)
        for (const pesan of [
            'Kata sandi ini terlalu umum dan mudah ditebak. Pilih kata sandi lain.',
            'Kata sandi tidak boleh memuat bagian depan alamat email (sebelum tanda @).',
            'Kata sandi tidak boleh memuat nama pengguna.',
        ]) expect(backend).toContain(pesan)
    })

    it('menolak kata sandi pendek, umum, atau yang memuat email dan nama pemilik akun', () => {
        const pemilik = { email: 'Siti.Rahma@example.test', name: 'Siti Rahmawati, S.H.' }
        expect(passwordRuleError('sebelas-chr', pemilik)).toBe('Kata sandi minimal 12 karakter.')
        expect(passwordRuleError('a'.repeat(129), pemilik)).toBe('Kata sandi maksimal 128 karakter.')
        expect(passwordRuleError('PASSWORD1234', pemilik)).toBe('Kata sandi ini terlalu umum dan mudah ditebak. Pilih kata sandi lain.')
        expect(passwordRuleError('2026-siti.rahma-x', pemilik)).toBe('Kata sandi tidak boleh memuat bagian depan alamat email (sebelum tanda @).')
        expect(passwordRuleError('kantor-RAHMAWATI-7', pemilik)).toBe('Kata sandi tidak boleh memuat nama pengguna.')
        // Bagian nama yang pendek (gelar, inisial) tidak ikut diperiksa.
        expect(passwordRuleError('lemari-shiso-biru-7', pemilik)).toBe('')
        expect(passwordRuleError('lemari-arsip-biru-7')).toBe('')
    })

    it('memeriksa konfirmasi setelah aturan', () => {
        expect(newPasswordError('lemari-arsip-biru-7', 'lain')).toBe('Konfirmasi kata sandi tidak sama.')
        expect(newPasswordError('lemari-arsip-biru-7', 'lemari-arsip-biru-7')).toBe('')
    })
})
