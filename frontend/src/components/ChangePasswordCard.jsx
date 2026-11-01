import { useEffect, useState } from 'react'
import { Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, newPasswordError } from '@/lib/password-policy'
import { authService } from '@/services/auth.service'

// Better Auth mengirim kode galat berbahasa Inggris; tampilkan padanannya.
const PESAN_KODE = {
    INVALID_PASSWORD: 'Kata sandi saat ini salah.',
    PASSWORD_TOO_SHORT: `Kata sandi baru minimal ${PASSWORD_MIN_LENGTH} karakter.`,
    PASSWORD_TOO_LONG: `Kata sandi maksimal ${PASSWORD_MAX_LENGTH} karakter.`,
    CREDENTIAL_ACCOUNT_NOT_FOUND: 'Akun ini belum memiliki kata sandi. Minta Super Admin mengatur kata sandi melalui Manajemen Pengguna.',
}

function pesanGagal(error) {
    if (error?.status === 429) return 'Terlalu banyak percobaan. Coba lagi setelah beberapa menit.'
    return PESAN_KODE[error?.code] || error?.message || 'Kata sandi gagal diubah. Coba lagi.'
}

function PasswordField({ id, label, value, onChange, visible, onToggle, autoComplete, describedBy, invalid, disabled }) {
    return <div className="space-y-2">
        <Label htmlFor={id}>{label}</Label>
        <div className="relative">
            <Input
                id={id}
                type={visible ? 'text' : 'password'}
                autoComplete={autoComplete}
                value={value}
                onChange={event => onChange(event.target.value)}
                maxLength={PASSWORD_MAX_LENGTH}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                disabled={disabled}
                className={onToggle ? 'pr-11' : undefined}
            />
            {onToggle && <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full w-10 text-muted-foreground hover:bg-transparent"
                onClick={onToggle}
                aria-label={visible ? `Sembunyikan ${label.toLowerCase()}` : `Tampilkan ${label.toLowerCase()}`}
                aria-pressed={visible}
            >
                {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>}
        </div>
    </div>
}

/**
 * Ubah kata sandi sendiri untuk akun email+kata sandi. Akun yang hanya masuk
 * dengan Google tidak memiliki kata sandi SIMSA, jadi formulir tidak ditampilkan.
 */
export function ChangePasswordCard() {
    const { toast } = useToast()
    // null: belum diketahui, mis. daftar metode masuk gagal dimuat. Formulir
    // tetap tampil karena server sendiri menolak akun tanpa kata sandi.
    const [hasCredential, setHasCredential] = useState(null)
    const [loading, setLoading] = useState(true)
    const [current, setCurrent] = useState('')
    const [next, setNext] = useState('')
    const [confirmation, setConfirmation] = useState('')
    const [showCurrent, setShowCurrent] = useState(false)
    const [showNext, setShowNext] = useState(false)
    const [error, setError] = useState('')
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        let active = true
        authService.listAccounts()
            .then(accounts => { if (active) setHasCredential(accounts.some(account => account.providerId === 'credential')) })
            .catch(() => { if (active) setHasCredential(null) })
            .finally(() => { if (active) setLoading(false) })
        return () => { active = false }
    }, [])

    async function submit(event) {
        event.preventDefault()
        if (saving) return
        const invalid = !current
            ? 'Masukkan kata sandi saat ini.'
            : newPasswordError(next, confirmation)
                || (next === current ? 'Kata sandi baru harus berbeda dari kata sandi saat ini.' : '')
        setError(invalid)
        if (invalid) return
        setSaving(true)
        try {
            await authService.changePassword(current, next)
            setCurrent('')
            setNext('')
            setConfirmation('')
            toast({ title: 'Berhasil', description: 'Kata sandi berhasil diubah. Sesi di perangkat lain telah ditutup.' })
        } catch (failure) {
            toast({ title: 'Gagal mengubah kata sandi', description: pesanGagal(failure), variant: 'destructive' })
        } finally {
            setSaving(false)
        }
    }

    return <Card className="border-border/60 shadow-sm overflow-hidden">
        <CardHeader className="bg-muted/50 border-b border-border pb-4">
            <CardTitle className="text-xl text-foreground">Ubah Kata Sandi</CardTitle>
            <CardDescription className="text-muted-foreground">
                Kata sandi untuk masuk dengan email. Setelah diubah, sesi di perangkat lain ditutup.
            </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
            {loading ? (
                <div className="space-y-4" aria-busy="true">
                    <Skeleton className="h-10 rounded-md" />
                    <Skeleton className="h-10 rounded-md" />
                </div>
            ) : hasCredential === false ? (
                <p className="text-sm text-muted-foreground">
                    Akun Anda masuk dengan Google sehingga tidak memiliki kata sandi SIMSA. Kata sandi dikelola di akun Google Anda.
                    Bila perlu masuk dengan email dan kata sandi, minta Super Admin mengaturnya melalui Manajemen Pengguna.
                </p>
            ) : (
                <form onSubmit={submit} className="space-y-4" aria-label="Ubah kata sandi" noValidate>
                    <PasswordField
                        id="settings-current-password"
                        label="Kata sandi saat ini"
                        value={current}
                        onChange={setCurrent}
                        visible={showCurrent}
                        onToggle={() => setShowCurrent(value => !value)}
                        autoComplete="current-password"
                        invalid={Boolean(error)}
                        disabled={saving}
                    />
                    <div className="grid gap-4 md:grid-cols-2">
                        <PasswordField
                            id="settings-new-password"
                            label="Kata sandi baru"
                            value={next}
                            onChange={setNext}
                            visible={showNext}
                            onToggle={() => setShowNext(value => !value)}
                            autoComplete="new-password"
                            describedBy="settings-new-password-hint"
                            invalid={Boolean(error)}
                            disabled={saving}
                        />
                        <PasswordField
                            id="settings-confirm-password"
                            label="Konfirmasi kata sandi baru"
                            value={confirmation}
                            onChange={setConfirmation}
                            visible={showNext}
                            autoComplete="new-password"
                            invalid={Boolean(error)}
                            disabled={saving}
                        />
                    </div>
                    <p id="settings-new-password-hint" className="text-xs text-muted-foreground">
                        {PASSWORD_MIN_LENGTH} sampai {PASSWORD_MAX_LENGTH} karakter.
                    </p>
                    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                    <div className="flex justify-end">
                        <Button type="submit" disabled={saving}>
                            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" /> : <KeyRound className="h-4 w-4 mr-2" aria-hidden="true" />}
                            Simpan Kata Sandi
                        </Button>
                    </div>
                </form>
            )}
        </CardContent>
    </Card>
}
