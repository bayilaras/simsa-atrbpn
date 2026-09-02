import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import {
    AlertCircle,
    BookOpen,
    CheckCircle2,
    Eye,
    EyeOff,
    FileCheck2,
    Loader2,
    ShieldCheck,
} from 'lucide-react'
import appConfig from '@/lib/app-config'

const BENEFITS = [
    'Temukan surat dan arsip dari satu pencarian',
    'Kelola klasifikasi, JRA, dan siklus hidup arsip',
    'Pantau akses dan aktivitas untuk akuntabilitas',
]

export default function Login() {
    const { signInWithGoogle, signInWithEmail, loading, error, isAuthenticated } = useAuth()
    const navigate = useNavigate()
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [localError, setLocalError] = useState('')

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
        <main id="main-content" className="min-h-svh bg-muted/30 lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(28rem,0.95fr)]">
            <section className="relative isolate overflow-hidden bg-primary px-5 py-4 text-primary-foreground sm:px-8 sm:py-8 lg:flex lg:min-h-svh lg:flex-col lg:justify-between lg:p-12 xl:p-16">
                <div aria-hidden="true" className="absolute -right-24 -top-24 -z-10 h-80 w-80 rounded-full bg-white/8 blur-2xl" />
                <div aria-hidden="true" className="absolute -bottom-32 -left-20 -z-10 h-96 w-96 rounded-full border border-white/10" />

                <div className="flex items-center gap-3">
                    <span className="inline-flex rounded-xl bg-white p-2 shadow-sm ring-1 ring-black/5">
                        <img src="/logo-simsa.png" alt="" className="h-10 w-10" />
                    </span>
                    <div className="min-w-0">
                        <p className="truncate text-sm font-semibold tracking-wide">{appConfig.shortName}</p>
                        <p className="truncate text-xs text-primary-foreground/90">Ditjen PTPP</p>
                    </div>
                    <Badge className="ml-auto border-white/20 bg-white/10 text-primary-foreground hover:bg-white/10">
                        {appConfig.usageBadge}
                    </Badge>
                </div>

                <div className="max-w-xl sm:mt-8 lg:my-auto">
                    <div className="mb-4 hidden h-12 w-12 items-center justify-center rounded-xl bg-white/10 lg:flex">
                        <FileCheck2 className="h-6 w-6" aria-hidden="true" />
                    </div>
                    <h1 className="sr-only max-w-lg text-2xl font-semibold leading-tight sm:not-sr-only sm:block sm:text-3xl lg:text-4xl">
                        Pengelolaan surat dan arsip yang tertib, efisien, dan akuntabel.
                    </h1>
                    <p className="mt-3 hidden max-w-xl text-sm leading-6 text-primary-foreground/80 sm:block sm:text-base">
                        Ruang kerja internal untuk membantu pengelolaan arsip dinamis di lingkungan Direktorat Jenderal Pengadaan Tanah dan Pengembangan Pertanahan.
                    </p>

                    <ul className="mt-8 hidden space-y-3 lg:block" aria-label="Manfaat utama SIMSA">
                        {BENEFITS.map((benefit) => (
                            <li key={benefit} className="flex items-center gap-3 text-sm text-primary-foreground/90">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10">
                                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                                </span>
                                {benefit}
                            </li>
                        ))}
                    </ul>
                </div>

                <p className="mt-8 hidden max-w-xl text-xs leading-5 text-primary-foreground/90 lg:block">
                    Gunakan hanya akun kedinasan yang telah diberi kewenangan. Selalu keluar dari aplikasi setelah menggunakan perangkat bersama.
                </p>
            </section>

            <section className="flex items-center justify-center px-4 py-6 sm:px-8 sm:py-10 lg:min-h-svh">
                <div className="w-full max-w-md">
                    <div className="mb-5">
                        <p className="text-sm font-medium text-primary">Akses internal</p>
                        <h2 className="mt-1 text-2xl font-semibold tracking-tight">Selamat datang</h2>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">
                            Masuk menggunakan akun kedinasan yang telah diberi kewenangan.
                        </p>
                    </div>

                    <Card className="gap-4 border-border/80 py-0 shadow-sm">
                        <CardHeader className="sr-only">
                            <CardTitle>Masuk ke {appConfig.shortName}</CardTitle>
                            <CardDescription>Masukkan email dan kata sandi, atau gunakan akun Google.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-5 px-5 pb-1 pt-5 sm:px-6 sm:pt-6">
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

                            <form onSubmit={handleEmailLogin} className="space-y-4" aria-busy={loading}>
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
                                            className="pr-12"
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
                                <Button type="submit" className="w-full" size="lg" disabled={loading}>
                                    {loading ? (
                                        <>
                                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                            Memproses…
                                        </>
                                    ) : 'Masuk'}
                                </Button>
                            </form>

                            <div className="relative py-1" role="separator" aria-label="Pilihan masuk lainnya">
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
                                className="w-full"
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
                        </CardContent>

                        <CardFooter className="flex-col gap-3 border-t bg-muted/25 px-5 py-4 sm:px-6">
                            <div className="flex w-full items-start gap-2 text-xs leading-5 text-muted-foreground">
                                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                                <span>Jangan membagikan kata sandi atau membiarkan sesi terbuka pada perangkat bersama.</span>
                            </div>
                        </CardFooter>
                    </Card>

                    <div className="mt-5 flex flex-col items-center justify-between gap-3 text-sm sm:flex-row">
                        <Button asChild variant="ghost" size="sm" className="min-h-11 text-muted-foreground">
                            <Link to="/panduan">
                                <BookOpen className="h-4 w-4" aria-hidden="true" />
                                Baca panduan pengguna
                            </Link>
                        </Button>
                        <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} Kementerian ATR/BPN</p>
                    </div>
                </div>
            </section>
        </main>
    )
}
