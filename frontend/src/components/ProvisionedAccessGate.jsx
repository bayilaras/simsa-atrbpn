import { LogOut, RefreshCw, ShieldAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import appConfig from '@/lib/app-config'
import { hasProvisionedAccess } from '@/lib/provisioning-access'

export function ProvisionedAccessGate({ user, onRefresh, onSignOut, children }) {
    if (hasProvisionedAccess(user)) return children

    const currentRole = typeof user?.role === 'string' && user.role.trim()
        ? user.role
        : 'belum ditetapkan'

    return (
        <main id="main-content" className="flex min-h-svh items-center justify-center bg-muted/30 px-4 py-10">
            <Card className="w-full max-w-xl border-amber-200 shadow-sm" role="status" aria-live="polite">
                <CardHeader className="items-center text-center">
                    <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                        <ShieldAlert className="h-7 w-7" aria-hidden="true" />
                    </div>
                    <CardTitle className="text-xl">Akun belum diprovisikan</CardTitle>
                    <CardDescription className="max-w-md leading-6">
                        Anda berhasil masuk, tetapi akses ke {appConfig.shortName} belum diaktifkan.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                    <div className="rounded-lg border bg-muted/40 p-4 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-medium">{user?.email || user?.name || 'Akun terautentikasi'}</span>
                            <Badge variant="outline">Peran: {currentRole}</Badge>
                        </div>
                        <p className="mt-3 leading-6 text-muted-foreground">
                            Hubungi Administrator SIMSA untuk menetapkan peran dan unit kerja sesuai tugas Anda.
                            Dashboard, menu data, dan proses arsip tidak dimuat sampai provisioning selesai.
                        </p>
                    </div>
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
                        <Button type="button" variant="outline" onClick={onSignOut}>
                            <LogOut className="h-4 w-4" aria-hidden="true" />
                            Keluar
                        </Button>
                        <Button type="button" onClick={onRefresh}>
                            <RefreshCw className="h-4 w-4" aria-hidden="true" />
                            Periksa ulang akses
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </main>
    )
}
