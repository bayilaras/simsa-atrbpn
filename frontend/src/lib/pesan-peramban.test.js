import { describe, expect, it, vi } from 'vitest'
import { gantiPesanPeramban } from './pesan-peramban'

function formulir() {
    const form = document.createElement('form')
    form.innerHTML = '<input name="a" type="date" required /><input name="b" type="date" min="2026-09-23" value="2026-09-20" />'
    document.body.append(form)
    return form
}
const peristiwa = target => ({ target, preventDefault: vi.fn() })

describe('gantiPesanPeramban', () => {
    it('membatalkan balon peramban dan menampilkan pesan aplikasi', () => {
        const form = formulir()
        form.elements.a.value = '2026-09-23'
        const tampilkan = vi.fn()
        const e = peristiwa(form.elements.b)
        gantiPesanPeramban(nilai => (nilai < '2026-09-23' ? 'Terlalu awal' : null), tampilkan)(e)
        expect(e.preventDefault).toHaveBeenCalledOnce()
        expect(tampilkan).toHaveBeenCalledWith('Terlalu awal')
        expect(document.activeElement).toBe(form.elements.b)
        form.remove()
    })

    it('tidak merebut fokus dari isian tak sah yang lebih dulu', () => {
        const form = formulir()
        const e = peristiwa(form.elements.b)
        gantiPesanPeramban(() => 'Terlalu awal', vi.fn())(e)
        expect(e.preventDefault).toHaveBeenCalledOnce()
        expect(document.activeElement).not.toBe(form.elements.b)
        form.remove()
    })

    it('membiarkan penandaan peramban bila aplikasi tidak punya pesan', () => {
        const form = formulir()
        const tampilkan = vi.fn()
        const e = peristiwa(form.elements.a)
        gantiPesanPeramban(() => null, tampilkan)(e)
        expect(e.preventDefault).not.toHaveBeenCalled()
        expect(tampilkan).not.toHaveBeenCalled()
        form.remove()
    })
})
