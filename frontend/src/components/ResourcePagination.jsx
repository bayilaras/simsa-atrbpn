import { Button } from '@/components/ui/button'

export function ResourcePagination({ resource, label }) {
    const { page, totalPages, total, loading, error, setPage, reload } = resource
    return <div className="space-y-3 border-t pt-3">
        {error && <div role="alert" className="text-sm text-destructive">
            <p>{error.message || 'Daftar gagal dimuat.'}</p>
            <Button type="button" variant="outline" className="mt-2" onClick={reload}>Coba lagi</Button>
        </div>}
        <nav aria-label={`Halaman ${label}`} className="flex flex-wrap items-center justify-between gap-3">
            <p role="status" className="text-sm text-muted-foreground">
                {loading ? 'Memuat daftar…' : error ? 'Daftar belum tersedia.' : `${total} data · Halaman ${page} dari ${totalPages}`}
            </p>
            <div className="flex gap-2">
                <Button type="button" variant="outline" disabled={loading || page <= 1} onClick={() => setPage(page - 1)}>Sebelumnya</Button>
                <Button type="button" variant="outline" disabled={loading || Boolean(error) || page >= totalPages} onClick={() => setPage(page + 1)}>Berikutnya</Button>
            </div>
        </nav>
    </div>
}
