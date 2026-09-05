import { AlertTriangle, FlaskConical } from 'lucide-react'
import { useAppConfig } from '@/context/app-config-context'

export function RuntimeConfigurationGate({ children }) {
    const { mode, loading, compatible, configurationError } = useAppConfig()

    if (mode === 'metadata-demo' && loading) {
        return (
            <main className="flex min-h-svh items-center justify-center bg-background p-6" role="status" aria-live="polite">
                <p className="text-sm text-muted-foreground">Memverifikasi profil demo…</p>
            </main>
        )
    }

    if (mode === 'metadata-demo' && !compatible) {
        return (
            <main className="flex min-h-svh items-center justify-center bg-background p-6">
                <section className="w-full max-w-lg rounded-xl border border-destructive/30 bg-card p-6 shadow-sm" role="alert">
                    <AlertTriangle className="mb-3 h-8 w-8 text-destructive" aria-hidden="true" />
                    <h1 className="text-lg font-semibold">Demo dihentikan demi keamanan</h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        {configurationError || 'Konfigurasi frontend dan backend tidak cocok.'}
                        {' '}Muat ulang setelah deployment backend metadata-demo tersedia.
                    </p>
                </section>
            </main>
        )
    }

    return (
        <>
            {mode === 'metadata-demo' && (
                <aside className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm font-medium text-amber-950" role="note">
                    <FlaskConical className="mr-2 inline h-4 w-4" aria-hidden="true" />
                    Demo — hanya gunakan data contoh. Unggah, impor, dan akses dokumen asli dinonaktifkan.
                </aside>
            )}
            {children}
        </>
    )
}

export default RuntimeConfigurationGate
