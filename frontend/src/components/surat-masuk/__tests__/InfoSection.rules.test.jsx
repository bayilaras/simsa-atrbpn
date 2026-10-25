import { render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { InfoSection } from '../InfoSection'

vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { files: false } }) }))

it('displays the authoritative incoming classification fields and saved JRA', () => {
    render(<InfoSection surat={{
        nomorSurat: '001/2026', perihal: 'Pengelolaan arsip',
        klasifikasiKode: 'TU.02.03', klasifikasiUraian: 'Pembinaan Kearsipan',
        jraKode: 'F.VI.03', jraUraian: 'Berkas pembinaan kearsipan', jraRetensiAktif: '2 tahun', jraRetensiInaktif: '3 tahun', jraKeterangan: 'Permanen',
    }} />)
    expect(screen.getByText('TU.02.03')).toBeInTheDocument()
    expect(screen.getByText('Pembinaan Kearsipan')).toBeInTheDocument()
    const retention = within(screen.getByRole('region', { name: 'Jadwal Retensi Arsip' }))
    expect(retention.getByText('F.VI.03')).toBeInTheDocument()
    expect(retention.getByText('2 tahun')).toBeInTheDocument()
    expect(retention.getByText('3 tahun')).toBeInTheDocument()
    expect(retention.getByText('Permanen')).toBeInTheDocument()
})
