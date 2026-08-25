import { ArrowLeft, FileQuestion } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import appConfig from '@/lib/app-config'

export default function NotFound() {
    return (
        <div className="flex min-h-[55vh] items-center justify-center px-4">
            <div className="max-w-lg space-y-5 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
                    <FileQuestion className="h-8 w-8 text-muted-foreground" />
                </div>
                <div className="space-y-2">
                    <Badge variant="outline">{appConfig.usageBadge}</Badge>
                    <h1 className="text-2xl font-bold tracking-tight">Halaman tidak tersedia</h1>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                        Halaman tidak ditemukan, tidak diaktifkan pada profil aplikasi ini, atau Anda tidak memiliki akses.
                    </p>
                </div>
                <Button asChild>
                    <Link to="/">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Kembali ke Dashboard
                    </Link>
                </Button>
            </div>
        </div>
    )
}
