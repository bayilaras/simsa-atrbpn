import { useAppConfig } from '@/context/app-config-context'
import { Button } from '@/components/ui/button'

export function RuntimeConfigurationGate({ children }) {
    const { loading, compatible, capabilities, checking, retryCapabilities } = useAppConfig()
    const retryButton = retryCapabilities && <Button type="button" className="mt-4" variant="outline"
        disabled={checking} onClick={retryCapabilities}>
        {checking ? 'Memeriksa layanan…' : 'Periksa lagi'}
    </Button>

    if (loading) {
        return (
            <main className="flex min-h-svh items-center justify-center bg-background p-6" role="status" aria-live="polite">
                <p className="text-sm text-muted-foreground">Memeriksa layanan aplikasi…</p>
            </main>
        )
    }

    if (!compatible && capabilities?.metadata === false) {
        return <main className="flex min-h-svh items-center justify-center bg-background p-6">
            <section role="alert" className="w-full max-w-lg rounded-xl border border-destructive/30 bg-card p-6">
                <h1 className="text-lg font-semibold">Konfigurasi aplikasi tidak cocok</h1>
                <p className="mt-2 text-sm text-muted-foreground">Profil atau layanan login server berbeda dari aplikasi ini. Hubungi administrator untuk menyamakan konfigurasi, lalu periksa kembali sebelum memasukkan data.</p>
                {retryButton}
            </section>
        </main>
    }

    return children
}

export default RuntimeConfigurationGate
