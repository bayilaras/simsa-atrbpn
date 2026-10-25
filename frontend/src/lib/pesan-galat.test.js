import { describe, expect, it } from 'vitest'
import { pesanGalat } from './pesan-galat'

/**
 * Bentuk galat nyata: backend `publicErrorResponse` (backend/src/utils/public-error.ts) mengirim
 * `{ success:false, error: <nama kelas>, message: <pesan domain>, code }`, lalu `api.js createApiError`
 * memasang body itu di `err.data` dan `err.response.data`, dengan `err.message = body.message || body.error`.
 */
function galatApi(status, body) {
    const err = new Error(body.message || body.error || `HTTP ${status}`)
    err.status = status
    err.data = body
    err.response = { status, data: body }
    return err
}

describe('pesanGalat', () => {
    it('memakai pesan domain dari backend, bukan nama kelas galat (FE-I1)', () => {
        const err = galatApi(409, {
            success: false, error: 'ConflictError', message: 'Koreksi Berkas sudah diputuskan.', code: 'CONFLICT',
        })
        expect(pesanGalat(err, 'cadangan')).toBe('Koreksi Berkas sudah diputuskan.')
    })

    it('memakai response.data.message bila hanya bentuk Axios yang tersedia', () => {
        const err = { message: 'Request failed with status code 422', response: { data: { error: 'AppError', message: 'Disposisikan dulu ke unit ini.' } } }
        expect(pesanGalat(err, 'cadangan')).toBe('Disposisikan dulu ke unit ini.')
    })

    it('tanpa message di body memakai err.message sebelum data.error', () => {
        const err = Object.assign(new Error('Sesi telah berakhir. Silakan login kembali.'), { data: { error: 'Unauthorized' } })
        expect(pesanGalat(err, 'cadangan')).toBe('Sesi telah berakhir. Silakan login kembali.')
        expect(pesanGalat({ data: { error: 'Validation failed' } }, 'cadangan')).toBe('Validation failed')
    })

    it('memakai cadangan bila tidak ada pesan apa pun', () => {
        expect(pesanGalat(undefined, 'Gagal menyimpan')).toBe('Gagal menyimpan')
        expect(pesanGalat({}, 'Gagal menyimpan')).toBe('Gagal menyimpan')
    })
})
