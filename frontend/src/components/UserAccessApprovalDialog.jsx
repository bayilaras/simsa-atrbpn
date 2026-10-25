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
    const invalidMandate = managedUserRoleError(role, unitKerjaId)

    async function approve(event) {
        event.preventDefault()
        if (saving || invalidMandate) return
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
                <div className="rounded-md border p-3 text-sm"><p className="font-medium">{user.name}</p><p className="break-all">{user.email}</p></div>
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
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Batal</Button>
                    <Button type="submit" disabled={saving || Boolean(invalidMandate)}>{saving ? 'Menyetujui…' : 'Setujui akses'}</Button>
                </DialogFooter>
            </form>
        </DialogContent>
    </Dialog>
}
