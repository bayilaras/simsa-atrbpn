import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
    AlertCircle,
    BookOpen,
    Eye,
    EyeOff,
    Loader2,
} from 'lucide-react'
import appConfig from '@/lib/app-config'
import { AUTH_PROVIDER } from '@/lib/cloud-provider-config'
import { useAppConfig } from '@/context/app-config-context'
import { AppServiceNotice } from '@/components/AppServiceNotice'

export default function Login() {
    const { signInWithGoogle, signInWithEmail, signOut, signingOut, logoutError, loading, error, isAuthenticated } = useAuth()
    const navigate = useNavigate()
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [localError, setLocalError] = useState('')
    const localDemo = appConfig.mode === 'metadata-demo' && AUTH_PROVIDER === 'better-auth'
    const runtime = useAppConfig()
    const googleAvailable = !runtime.loading && runtime.authentication?.googleSignIn === true
        && runtime.authentication?.provider === AUTH_PROVIDER && !localDemo

    if (signingOut) {
        return <main className="flex min-h-svh items-center justify-center bg-background p-6" role="status" aria-live="polite">
            <p className="text-sm text-muted-foreground">Menutup sesi di server…</p>
        </main>
    }

    if (isAuthenticated) {
        return <Navigate to="/" replace />
    }

    const handleEmailLogin = async (event) => {
        event.preventDefault()
        setLocalError('')

        try {
            await signInWithEmail(email, password)
            navigate('/', { replace: true })
        } catch (loginError) {
            setLocalError(loginError.message || 'Login gagal. Periksa kembali akun Anda.')
        }
    }

    const displayError = localError || error

    return (
        <main id="main-content" className="flex min-h-svh items-center justify-center bg-muted/30 px-4 py-6 sm:py-8">
            <div className="w-full max-w-md">
                <Card className="gap-6 border-border/80 py-6 shadow-sm sm:py-8">
                    <CardHeader className="gap-0 px-6 sm:px-8">
                        <div className="flex items-center gap-3">
                            <img src="/logo-simsa.png" alt="" className="h-11 w-11 shrink-0" />
                            <div>
                                <h1 className="text-xl font-semibold tracking-tight">{appConfig.shortName}</h1>
                                <p className="mt-0.5 text-sm text-muted-foreground">Ditjen PTPP</p>
                            </div>
                        </div>
                        <CardDescription className="sr-only">{localDemo
                            ? 'Masukkan email dan kata sandi akun uji lokal.'
                            : googleAvailable ? 'Masukkan email dan kata sandi, atau gunakan akun Google.'
                                : 'Masukkan email dan kata sandi yang diberikan administrator.'}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5 px-6 sm:px-8">
                        {displayError && (
                            <div
                                role="alert"
                                aria-live="polite"
                                className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
                            >
                                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                                <span>{displayError}</span>
                            </div>
                        )}
                        {logoutError && <Button type="button" variant="outline" className="w-full" onClick={signOut} disabled={loading}>
                            Coba keluar lagi
                        </Button>}

                        <form onSubmit={handleEmailLogin} className="space-y-4" aria-label="Masuk ke SIMSA" aria-busy={loading}>
                            <div className="space-y-2">
                                <Label htmlFor="email">Email kedinasan</Label>
                                <Input
                                    id="email"
                                    name="email"
                                    type="email"
                                    inputMode="email"
                                    autoComplete="email"
                                    placeholder="nama@atrbpn.go.id"
                                    value={email}
                                    onChange={(event) => setEmail(event.target.value)}
                                    required
                                    className="h-11"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="password">Kata sandi</Label>
                                <div className="relative">
                                    <Input
                                        id="password"
                                        name="password"
                                        type={showPassword ? 'text' : 'password'}
                                        autoComplete="current-password"
                                        placeholder="Masukkan kata sandi"
                                        value={password}
                                        onChange={(event) => setPassword(event.target.value)}
                                        required
                                        className="h-11 pr-12"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword((visible) => !visible)}
                                        className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                                        aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                                        aria-pressed={showPassword}
                                    >
                                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </button>
                                </div>
                            </div>
                            <Button type="submit" className="h-11 w-full" size="lg" disabled={loading}>
                                {loading ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                        Memproses…
                                    </>
                                ) : 'Masuk'}
                            </Button>
                        </form>

                        {googleAvailable && <><div className="relative py-1" role="separator" aria-label="Pilihan masuk lainnya">
                            <div className="absolute inset-0 flex items-center" aria-hidden="true">
                                <Separator className="w-full" />
                            </div>
                            <div className="relative flex justify-center text-xs uppercase">
                                <span className="bg-card px-2 text-muted-foreground">atau</span>
                            </div>
                        </div>

                        <Button
                            type="button"
                            onClick={signInWithGoogle}
                            disabled={loading}
                            variant="outline"
                            className="h-11 w-full"
                            size="lg"
                        >
                            <svg aria-hidden="true" focusable="false" className="h-5 w-5" viewBox="0 0 24 24">
                                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                            </svg>
                            {loading ? 'Menghubungkan…' : 'Masuk dengan Google'}
                        </Button>
                        {runtime.authentication?.pendingGoogleSignup === true && <p className="text-center text-xs leading-5 text-muted-foreground">
                            Akun Google baru perlu persetujuan administrator.
                        </p>}</>}
                    </CardContent>
                </Card>

                <div className="mt-4"><AppServiceNotice /></div>

                <footer className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <Link to="/panduan" className="inline-flex min-h-11 items-center gap-1.5 rounded-sm px-1 transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
                        <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                        Panduan pengguna
                    </Link>
                    <p>© {new Date().getFullYear()} Kementerian ATR/BPN</p>
                </footer>
            </div>
        </main>
    )
}
