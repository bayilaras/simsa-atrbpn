import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppConfigContext } from '@/context/app-config-context'
import { FileCapabilityGuard } from './FileCapabilityGuard'

function show(capabilities, upload = false) {
    return render(<AppConfigContext.Provider value={{ mode: 'full', loading: false, capabilities }}>
        <MemoryRouter><FileCapabilityGuard upload={upload}><p>Fitur berkas</p></FileCapabilityGuard></MemoryRouter>
    </AppConfigContext.Provider>)
}
describe('file capability route guidance', () => {
    it('explains unavailable storage without showing an upload or a misleading 404', () => {
        show({ files: false, fileUploads: false })
        expect(screen.queryByText('Fitur berkas')).not.toBeInTheDocument()
        expect(screen.getByRole('note')).toHaveTextContent('penyimpanan berkas belum tersedia')
        expect(screen.getByRole('link', { name: 'Kembali ke daftar arsip' })).toHaveAttribute('href', '/arsip')
    })
    it('retains file reading when scanning is disabled', () => {
        show({ files: true, fileUploads: false })
        expect(screen.getByText('Fitur berkas')).toBeInTheDocument()
    })
    it('stops bulk uploads and explains quarantine when scanning is disabled', () => {
        show({ files: true, fileUploads: false }, true)
        expect(screen.queryByText('Fitur berkas')).not.toBeInTheDocument()
        expect(screen.getByRole('note')).toHaveTextContent('pemeriksaan keamanan berkas belum tersedia')
    })
})
