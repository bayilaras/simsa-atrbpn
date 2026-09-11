import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppConfigContext, DISABLED_FEATURES } from '@/context/app-config-context'
import { RuntimeConfigurationGate } from './RuntimeConfigurationGate'

function renderGate(value) {
    return render(
        <AppConfigContext.Provider value={{ features: DISABLED_FEATURES, ...value }}>
            <RuntimeConfigurationGate>
                <p>Konten aplikasi</p>
            </RuntimeConfigurationGate>
        </AppConfigContext.Provider>,
    )
}

describe('RuntimeConfigurationGate', () => {
    it('waits for the initial full handshake before mounting forms or auth', () => {
        renderGate({ mode: 'full', loading: true, compatible: false })
        expect(screen.getByRole('status')).toHaveTextContent('Memeriksa layanan aplikasi')
        expect(screen.queryByText('Konten aplikasi')).not.toBeInTheDocument()
    })
    it('blocks a full build after an explicit backend mode or provider mismatch', () => {
        renderGate({ mode: 'full', loading: false, compatible: false, capabilities: { metadata: false } })
        expect(screen.getByRole('alert')).toHaveTextContent('Konfigurasi aplikasi tidak cocok')
        expect(screen.queryByText('Konten aplikasi')).not.toBeInTheDocument()
    })
    it('allows full metadata after a network probe failure while leaving files disabled', () => {
        renderGate({ mode: 'full', loading: false, compatible: false,
            capabilities: { metadata: true, files: false, fileUploads: false }, configurationError: 'Pemeriksaan layanan gagal.' })
        expect(screen.getByText('Konten aplikasi')).toBeInTheDocument()
        expect(screen.getByRole('note')).toHaveTextContent('Pemeriksaan layanan gagal')
    })
    it('preserves the existing full-mode UI without a demo banner', () => {
        renderGate({ mode: 'full', loading: false, compatible: true })

        expect(screen.getByText('Konten aplikasi')).toBeInTheDocument()
        expect(screen.queryByRole('note')).not.toBeInTheDocument()
    })

    it('labels a verified metadata demo and warns against real data', () => {
        renderGate({ mode: 'metadata-demo', loading: false, compatible: true })

        expect(screen.getByRole('note')).toHaveTextContent('hanya gunakan data contoh')
        expect(screen.getByRole('note')).toHaveTextContent('Unggah, impor, dan akses dokumen asli dinonaktifkan')
        expect(screen.getByText('Konten aplikasi')).toBeInTheDocument()
    })

    it('does not mount application work when the backend capability contract mismatches', () => {
        renderGate({
            mode: 'metadata-demo',
            loading: false,
            compatible: false,
            configurationError: 'Backend tidak cocok.',
        })

        expect(screen.getByRole('alert')).toHaveTextContent('Demo dihentikan demi keamanan')
        expect(screen.getByRole('alert')).toHaveTextContent('Backend tidak cocok.')
        expect(screen.queryByText('Konten aplikasi')).not.toBeInTheDocument()
    })
})
