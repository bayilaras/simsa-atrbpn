import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import api from '@/services/api';

const statuses = {
    healthy: { label: 'Sehat', className: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' },
    attention: { label: 'Perlu perhatian', className: 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200' },
    failed: { label: 'Gagal', className: 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200' },
    unknown: { label: 'Belum terverifikasi', className: 'bg-muted text-muted-foreground' },
    disabled: { label: 'Tidak diaktifkan', className: 'bg-muted text-muted-foreground' },
};
const countLabels = { waiting: 'Menunggu', overdue: 'Terlambat', errors: 'Gagal', unscheduled: 'Belum terjadwal', mismatched: 'Tidak cocok' };
function timestamp(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(date) + ' WIB' : 'Belum tersedia';
}
function StatusBadge({ status }) {
    const config = statuses[status] || statuses.unknown;
    return <Badge className={config.className}>{config.label}</Badge>;
}

export default function OperationsMonitoring() {
    const [snapshot, setSnapshot] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const active = useRef(null);
    const refresh = useCallback(async () => {
        active.current?.abort();
        const controller = new AbortController();
        active.current = controller;
        setLoading(true); setError(false);
        try {
            const result = await api.get('/api/operations/status', {}, { signal: controller.signal });
            if (!controller.signal.aborted) setSnapshot(result.data);
        } catch {
            if (!controller.signal.aborted) { setSnapshot(null); setError(true); }
        } finally {
            if (!controller.signal.aborted) setLoading(false);
        }
    }, []);
    useEffect(() => {
        refresh();
        const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 60000);
        return () => { clearInterval(timer); active.current?.abort(); };
    }, [refresh]);

    return <section className="space-y-6 p-4 md:p-6" aria-label="Monitoring operasional">
        <div className="flex flex-wrap items-start justify-between gap-4">
            <div><h1 className="text-2xl font-semibold">Monitoring Operasional</h1>
                <p className="mt-1 text-sm text-muted-foreground">Kesehatan layanan, antrean dokumen, dan bukti pemulihan.</p></div>
            <div className="flex flex-wrap gap-2">
                <Button variant="outline" asChild><a href="https://github.com/bayilaras/simsa-atrbpn/actions" target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-4 w-4" />Buka status CI</a></Button>
                <Button variant="outline" onClick={refresh} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Perbarui</Button>
            </div>
        </div>
        {error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">Gagal memuat status. Periksa koneksi, lalu tekan Perbarui.</div>}
        {loading && <p role="status" className="text-sm text-muted-foreground">Memeriksa status operasional…</p>}
        {snapshot && <>
            <div className="flex flex-wrap items-center gap-3 text-sm" aria-live="polite"><StatusBadge status={snapshot.status} /><span className="text-muted-foreground">Diperiksa {timestamp(snapshot.timestamp)}</span></div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {snapshot.checks.map(check => <Card key={check.id}>
                    <CardHeader className="space-y-3 pb-3"><CardTitle className="text-base">{check.label}</CardTitle><div><StatusBadge status={check.status} /></div></CardHeader>
                    <CardContent className="space-y-3 text-sm"><p className="text-muted-foreground">{check.message}</p>
                        {check.counts && <dl className="grid grid-cols-2 gap-2">{Object.entries(check.counts).map(([key, value]) => <div key={key}><dt className="text-xs text-muted-foreground">{countLabels[key] || key}</dt><dd className="font-semibold tabular-nums">{value}</dd></div>)}</dl>}
                        {check.checkedAt && <p className="text-xs text-muted-foreground">Bukti terakhir: {timestamp(check.checkedAt)}</p>}
                        {check.expiresAt && <p className="text-xs text-muted-foreground">Berlaku hingga: {timestamp(check.expiresAt)}</p>}
                    </CardContent>
                </Card>)}
            </div>
            <p className="text-xs text-muted-foreground">Status diperbarui setiap menit saat halaman aktif. Uji pemulihan mencakup database dan berkas dokumen; bukti yang belum lengkap ditandai untuk ditindaklanjuti.</p>
        </>}
    </section>;
}
