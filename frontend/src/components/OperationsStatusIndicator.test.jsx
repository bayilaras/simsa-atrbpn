import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OperationsStatusIndicator } from './OperationsStatusIndicator'

const state = vi.hoisted(() => ({ user: { role: 'super_admin' } }))
const mocks = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: state.user }) }))
vi.mock('@/services/api', () => ({ default: { get: mocks.get } }))

const tampilkan = () => render(<MemoryRouter><OperationsStatusIndicator /></MemoryRouter>)
beforeEach(() => { mocks.get.mockReset(); state.user = { role: 'super_admin' } })
afterEach(cleanup)

describe('indikator status operasional di header', () => {
    it.each([
        ['attention', 'Monitoring Operasional: perlu perhatian. Buka halaman Monitoring Operasional.', 'Operasional: perlu perhatian'],
        ['failed', 'Monitoring Operasional: gagal. Buka halaman Monitoring Operasional.', 'Operasional: gagal'],
    ])('menautkan Super Admin ke Monitoring Operasional saat status %s', async (status, nama, teks) => {
        mocks.get.mockResolvedValue({ success: true, data: { status, checks: [] } })
        tampilkan()
        const tautan = await screen.findByRole('link', { name: nama })
        expect(tautan).toHaveAttribute('href', '/monitoring-operasional')
        expect(tautan).toHaveTextContent(teks)
    })

    it('tidak tampil saat semua pemeriksaan sehat', async () => {
        mocks.get.mockResolvedValue({ success: true, data: { status: 'healthy', checks: [] } })
        const { container } = tampilkan()
        await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(1))
        expect(container).toBeEmptyDOMElement()
    })

    it('tidak tampil bila status belum dapat dimuat', async () => {
        mocks.get.mockRejectedValue(new Error('jaringan'))
        const { container } = tampilkan()
        await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(1))
        expect(container).toBeEmptyDOMElement()
    })

    it.each(['admin_unit', 'admin_dirjen', 'admin_sesditjen', 'staff', 'auditor', 'user'])('tidak meminta status untuk peran %s', role => {
        state.user = { role }
        const { container } = tampilkan()
        expect(container).toBeEmptyDOMElement()
        expect(mocks.get).not.toHaveBeenCalled()
    })
})
