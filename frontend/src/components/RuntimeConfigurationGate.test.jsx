import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppConfigContext, DISABLED_FEATURES } from '@/context/app-config-context'
import { RuntimeConfigurationGate } from './RuntimeConfigurationGate'
import { AppServiceNotice } from './AppServiceNotice'

function renderGate(value) {
    return render(
        <AppConfigContext.Provider value={{ features: DISABLED_FEATURES, ...value }}>
            <RuntimeConfigurationGate>
                <AppServiceNotice />
                <p>Konten aplikasi</p>
            </RuntimeConfigurationGate>
        </AppConfigContext.Provider>,
    )
}

describe('RuntimeConfigurationGate', () => {
    it('waits for the initial full handshake before mounting forms or auth', () => {
        renderGate({ loading: true, compatible: false })
        expect(screen.getByRole('status')).toHaveTextContent('Memeriksa layanan aplikasi')
        expect(screen.queryByText('Konten aplikasi')).not.toBeInTheDocument()
    })
    it('blocks a full build after an explicit backend mode or provider mismatch', () => {
        renderGate({ loading: false, compatible: false, capabilities: { metadata: false } })
        expect(screen.getByRole('alert')).toHaveTextContent('Konfigurasi aplikasi tidak cocok')
        expect(screen.queryByText('Konten aplikasi')).not.toBeInTheDocument()
    })
    it('allows full metadata after a network probe failure while leaving files disabled', () => {
        renderGate({ loading: false, compatible: false,
            capabilities: { metadata: true, files: false, fileUploads: false }, configurationError: 'Pemeriksaan layanan gagal.' })
        expect(screen.getByText('Konten aplikasi')).toBeInTheDocument()
        expect(screen.getByRole('note')).toHaveTextContent('Pemeriksaan layanan gagal')
    })
    it('mounts the application without a notice when the handshake succeeds', () => {
        renderGate({ loading: false, compatible: true })

        expect(screen.getByText('Konten aplikasi')).toBeInTheDocument()
        expect(screen.queryByRole('note')).not.toBeInTheDocument()
    })
})
