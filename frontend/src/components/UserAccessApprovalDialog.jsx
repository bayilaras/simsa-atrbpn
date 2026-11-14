import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ASSIGNABLE_ROLE_OPTIONS, managedUserRoleError } from '@/lib/role-access'
import userManagementService from '@/services/user-management.service'

export function UserAccessApprovalDialog({ user, unitKerjaList, onClose, onApproved }) {
    const [role, setRole] = useState('')
    const [unitKerjaId, setUnitKerjaId] = useState('')
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    // Siapa pun dapat mendaftar dengan akun Google; pemilik email dipastikan dahulu.
    const [ownerConfirmed, setOwnerConfirmed] = useState(false)
    const invalidMandate = managedUserRoleError(role, unitKerjaId)

    async function approve(event) {
        event.preventDefault()
        if (saving || invalidMandate || !ownerConfirmed) return
        setSaving(true)
        setError('')
        try {
            const result = await userManagementService.updateUser(user.id, { role, unitKerjaId: role === 'super_admin' ? null : unitKerjaId, isActive: true })
            if (result?.success !== true) throw new Error('Persetujuan belum terkonfirmasi. Coba lagi.')
            onApproved(user)
        } catch (failure) {
            setError(failure.message || 'Gagal menyetujui akses. Coba lagi.')
        } finally {
            setSaving(false)
        }
    }

    return <Dialog open onOpenChange={open => { if (!open && !saving) onClose() }}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Setujui akses pengguna</DialogTitle>
                <DialogDescription>Tetapkan kewenangan sesuai tugas pengguna. Setelah persetujuan, pengguna perlu masuk kembali karena sesi lama akan ditutup.</DialogDescription>
            </DialogHeader>
            <form onSubmit={approve} className="space-y-4">
                <div className="rounded-md border p-3 text-sm">
                    <p className="text-xs text-muted-foreground">Email akun yang meminta akses</p>
                    <p className="break-all text-base font-semibold text-foreground">{user.email}</p>
                    <p className="mt-1 text-muted-foreground">Nama dari akun: {user.name || '-'}</p>
                </div>
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <div className="space-y-2">
                    <Label>Peran</Label>
                    <Select value={role} onValueChange={value => { setRole(value); if (value === 'super_admin') setUnitKerjaId('') }} disabled={saving}>
                        <SelectTrigger aria-label="Peran untuk persetujuan"><SelectValue placeholder="Pilih peran" /></SelectTrigger>
                        <SelectContent>{ASSIGNABLE_ROLE_OPTIONS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label>Unit kerja</Label>
                    <Select value={unitKerjaId} onValueChange={setUnitKerjaId} disabled={saving || role !== 'admin_unit'}>
                        <SelectTrigger aria-label="Unit kerja untuk persetujuan"><SelectValue placeholder="Pilih unit kerja" /></SelectTrigger>
                        <SelectContent>{unitKerjaList.map(unit => <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <p className="text-sm text-muted-foreground">{role === 'super_admin' ? 'Super Admin memiliki akses lintas unit tanpa unit kerja tersimpan.' : 'Admin Unit Kerja wajib ditetapkan pada satu unit kerja.'}</p>
                </div>
                <div className="flex items-start gap-2">
                    <input id="approval-owner-confirmed" type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary" checked={ownerConfirmed} onChange={event => setOwnerConfirmed(event.target.checked)} disabled={saving} />
                    <Label htmlFor="approval-owner-confirmed" className="text-sm font-normal leading-5">Saya sudah memastikan langsung kepada pemilik email ini.</Label>
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Batal</Button>
                    <Button type="submit" disabled={saving || Boolean(invalidMandate) || !ownerConfirmed}>{saving ? 'Menyetujui…' : 'Setujui akses'}</Button>
                </DialogFooter>
            </form>
        </DialogContent>
    </Dialog>
}
