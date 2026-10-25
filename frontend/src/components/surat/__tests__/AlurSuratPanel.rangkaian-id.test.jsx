import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ getById: vi.fn(), getBySurat: vi.fn() }))
vi.mock('@/components/surat/KoreksiBerkasSection', () => ({ default: () => null }))
vi.mock('@/services/rangkaian.service', () => ({ default: mocks, rangkaianService: mocks }))
import { AlurSuratPanel } from '../AlurSuratPanel'

beforeEach(() => {
    vi.clearAllMocks()
    mocks.getById.mockReturnValue(new Promise(() => {}))
    mocks.getBySurat.mockReturnValue(new Promise(() => {}))
})
afterEach(cleanup)

describe('AlurSuratPanel dengan rangkaianId (Lacak Surat)', () => {
    it('memuat lewat getById bila rangkaianId diberikan', () => {
        render(<MemoryRouter><AlurSuratPanel rangkaianId="11111111-1111-4111-8111-111111111111" /></MemoryRouter>)
        expect(mocks.getById).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111')
        expect(mocks.getBySurat).not.toHaveBeenCalled()
        expect(screen.getByText('Memuat alur surat…')).toBeVisible()
    })
    it('tetap memakai getBySurat tanpa rangkaianId (perilaku P2)', () => {
        render(<MemoryRouter><AlurSuratPanel jenis="surat_masuk" suratId="s1" /></MemoryRouter>)
        expect(mocks.getBySurat).toHaveBeenCalledWith('surat_masuk', 's1')
        expect(mocks.getById).not.toHaveBeenCalled()
    })
    it('rangkaianId yang 404 menampilkan keadaan netral, bukan galat', async () => {
        mocks.getById.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }))
        render(<MemoryRouter><AlurSuratPanel rangkaianId="11111111-1111-4111-8111-111111111111" /></MemoryRouter>)
        expect(await screen.findByRole('status')).toHaveTextContent('Alur surat tidak tersedia untuk Anda.')
        expect(screen.queryByRole('alert')).toBeNull()
    })
})
