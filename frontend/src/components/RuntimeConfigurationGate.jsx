import { AlertTriangle } from 'lucide-react'
import { useAppConfig } from '@/context/app-config-context'
import { Button } from '@/components/ui/button'

export function RuntimeConfigurationGate({ children }) {
    const { mode, loading, compatible, configurationError, capabilities, checking, retryCapabilities } = useAppConfig()
    const retryButton = retryCapabilities && <Button type="button" className="mt-4" variant="outline"
        disabled={checking} onClick={retryCapabilities}>
        {checking ? 'Memeriksa layanan…' : 'Periksa lagi'}
    </Button>

    if (loading) {
        return (
            <main className="flex min-h-svh items-center justify-center bg-background p-6" role="status" aria-live="polite">
                <p className="text-sm text-muted-foreground">{mode === 'metadata-demo' ? 'Memverifikasi profil demo…' : 'Memeriksa layanan aplikasi…'}</p>
            </main>
        )
    }

    if (mode === 'full' && !compatible && capabilities?.metadata === false) {
        return <main className="flex min-h-svh items-center justify-center bg-background p-6">
            <section role="alert" className="w-full max-w-lg rounded-xl border border-destructive/30 bg-card p-6">
                <h1 className="text-lg font-semibold">Konfigurasi aplikasi tidak cocok</h1>
                <p className="mt-2 text-sm text-muted-foreground">Profil atau layanan login server berbeda dari aplikasi ini. Hubungi administrator untuk menyamakan konfigurasi, lalu periksa kembali sebelum memasukkan data.</p>
                {retryButton}
            </section>
        </main>
    }

    if (mode === 'metadata-demo' && !compatible) {
        return (
            <main className="flex min-h-svh items-center justify-center bg-background p-6">
                <section className="w-full max-w-lg rounded-xl border border-destructive/30 bg-card p-6 shadow-sm" role="alert">
                    <AlertTriangle className="mb-3 h-8 w-8 text-destructive" aria-hidden="true" />
                    <h1 className="text-lg font-semibold">Demo dihentikan demi keamanan</h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        {configurationError || 'Konfigurasi frontend dan backend tidak cocok.'}
                        {' '}Periksa kembali setelah deployment backend metadata-demo tersedia.
                    </p>
                    {retryButton}
                </section>
            </main>
        )
    }

    return children
}

export default RuntimeConfigurationGate
