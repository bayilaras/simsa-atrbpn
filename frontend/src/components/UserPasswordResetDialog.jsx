import { useState } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { pesanGalat } from '@/lib/pesan-galat'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, newPasswordError } from '@/lib/password-policy'
import userManagementService from '@/services/user-management.service'

export function UserPasswordResetDialog({ user, onClose, onReset }) {
    const { toast } = useToast()
    const [password, setPassword] = useState('')
    const [confirmation, setConfirmation] = useState('')
    const [visible, setVisible] = useState(false)
    const [error, setError] = useState('')
    const [saving, setSaving] = useState(false)
    const label = user.name || user.email

    async function submit(event) {
        event.preventDefault()
        if (saving) return
        const invalid = newPasswordError(password, confirmation)
        setError(invalid)
        if (invalid) return
        setSaving(true)
        try {
            const result = await userManagementService.resetPassword(user.id, password)
            if (result?.success !== true) throw new Error('Perubahan kata sandi belum terkonfirmasi. Coba lagi.')
            toast({
                title: 'Berhasil',
                description: `Kata sandi ${label} diatur ulang. Pengguna perlu masuk kembali dengan kata sandi baru.`,
            })
            onReset(user)
        } catch (failure) {
            toast({
                title: 'Gagal mengatur ulang kata sandi',
                description: pesanGalat(failure, 'Coba lagi beberapa saat lagi.'),
                variant: 'destructive',
            })
        } finally {
            setSaving(false)
        }
    }

    return <Dialog open onOpenChange={open => { if (!open && !saving) onClose() }}>
        <DialogContent className="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>Atur Ulang Kata Sandi</DialogTitle>
                <DialogDescription>
                    Kata sandi baru langsung berlaku dan semua sesi pengguna ini ditutup. Sampaikan kata sandi kepada pengguna secara langsung.
                </DialogDescription>
            </DialogHeader>
            <form onSubmit={submit} className="space-y-4" noValidate>
                <div className="rounded-md border p-3 text-sm">
                    <p className="font-medium">{user.name || '-'}</p>
                    <p className="break-all text-muted-foreground">{user.email}</p>
                </div>
                {user.isActive === false && <p className="text-sm text-muted-foreground">
                    Akun ini nonaktif. Pengguna baru dapat masuk setelah akun diaktifkan kembali.
                </p>}
                <div className="space-y-2">
                    <Label htmlFor="reset-password-new">Kata sandi baru</Label>
                    <div className="relative">
                        <Input
                            id="reset-password-new"
                            type={visible ? 'text' : 'password'}
                            autoComplete="new-password"
                            value={password}
                            onChange={event => setPassword(event.target.value)}
                            maxLength={PASSWORD_MAX_LENGTH}
                            aria-describedby="reset-password-hint"
                            aria-invalid={Boolean(error)}
                            disabled={saving}
                            className="pr-11"
                        />
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute right-0 top-0 h-full w-10 text-muted-foreground hover:bg-transparent"
                            onClick={() => setVisible(value => !value)}
                            aria-label={visible ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                            aria-pressed={visible}
                        >
                            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                    </div>
                    <p id="reset-password-hint" className="text-xs text-muted-foreground">
                        {PASSWORD_MIN_LENGTH} sampai {PASSWORD_MAX_LENGTH} karakter.
                    </p>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="reset-password-confirm">Konfirmasi kata sandi baru</Label>
                    <Input
                        id="reset-password-confirm"
                        type={visible ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={confirmation}
                        onChange={event => setConfirmation(event.target.value)}
                        maxLength={PASSWORD_MAX_LENGTH}
                        aria-invalid={Boolean(error)}
                        disabled={saving}
                    />
                </div>
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Batal</Button>
                    <Button type="submit" disabled={saving}>
                        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                        {saving ? 'Menyimpan…' : 'Atur Ulang Kata Sandi'}
                    </Button>
                </DialogFooter>
            </form>
        </DialogContent>
    </Dialog>
}
