import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import api from '@/services/api';
import { umumkanStatusOperasional } from '@/lib/operations-status';

const statuses = {
    healthy: { label: 'Sehat', className: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' },
    attention: { label: 'Perlu perhatian', className: 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200' },
    failed: { label: 'Gagal', className: 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200' },
    unknown: { label: 'Belum terverifikasi', className: 'bg-muted text-muted-foreground' },
    disabled: { label: 'Tidak diaktifkan', className: 'bg-muted text-muted-foreground' },
};
const countLabels = { waiting: 'Menunggu', overdue: 'Terlambat', errors: 'Gagal', infected: 'Terdeteksi berbahaya', unscheduled: 'Belum terjadwal', mismatched: 'Tidak cocok', stale: 'Belum terhapus' };
const sourceLabels = { surat_masuk: 'Surat masuk', surat_keluar: 'Surat keluar', arsip: 'Arsip' };
const REQUEUE_FAILED = 'Berkas belum dapat diantre ulang. Coba lagi beberapa saat lagi.';
const SCANNER_RUN_FAILED = 'Pemindai belum dapat dijalankan. Coba lagi beberapa saat lagi.';
function timestamp(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(date) + ' WIB' : 'Belum tersedia';
}
function StatusBadge({ status }) {
    const config = statuses[status] || statuses.unknown;
    return <Badge className={config.className}>{config.label}</Badge>;
}

// Super Admin recovery for files whose security scan failed. Infected files
// are not listed by the server and cannot be requeued.
function FailedScans({ checkedAt, onChanged, onNotice }) {
    const [list, setList] = useState(null);
    const [loadError, setLoadError] = useState(false);
    const [busy, setBusy] = useState('');
    const [failure, setFailure] = useState('');
    const [reload, setReload] = useState(0);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        let current = true;
        api.get('/api/operations/scan-failures')
            .then(result => { if (current) { setList(result.data); setLoadError(false); } })
            .catch(() => { if (current) { setList(null); setLoadError(true); } });
        return () => { current = false; mounted.current = false; };
    }, [reload, checkedAt]);
    const requeue = async (file) => {
        if (busy) return;
        setBusy(file ? file.id : 'all'); onNotice(''); setFailure('');
        try {
            const result = await api.post(file ? `/api/operations/scan-failures/${encodeURIComponent(file.id)}/requeue` : '/api/operations/scan-failures/requeue', {});
            if (!mounted.current) return;
            const { requeued = 0, remaining = 0 } = result?.data || {};
            onNotice(requeued
                ? `${requeued} berkas diantrekan untuk dipindai ulang.${remaining ? ` Masih ada ${remaining} berkas yang gagal dipindai; tekan lagi untuk melanjutkan.` : ''} Berkas dapat dibuka setelah dinyatakan aman.`
                : 'Tidak ada berkas yang perlu diantre ulang.');
        } catch (error) {
            if (mounted.current) setFailure(error?.status === 409 || error?.status === 429 ? (error.message || REQUEUE_FAILED) : REQUEUE_FAILED);
        } finally {
            if (mounted.current) { setBusy(''); setReload(value => value + 1); onChanged?.(); }
        }
    };
    return <div className="space-y-3 rounded-md border bg-muted/20 p-3" role="group" aria-label="Berkas gagal dipindai">
        <p className="font-medium">Berkas gagal dipindai</p>
        <p className="text-muted-foreground">Berkas ini belum dapat dibuka karena pemindaian keamanannya gagal. Antre ulang agar berkas dipindai lagi; berkas baru dapat dibuka setelah dinyatakan aman. Berkas yang terdeteksi berbahaya tidak dapat diantre ulang.</p>
        {failure && <p role="alert" className="text-destructive">{failure}</p>}
        {loadError && <p role="alert" className="text-destructive">Daftar berkas yang gagal dipindai belum dapat dimuat. Tekan Perbarui untuk mencoba lagi.</p>}
        {list && list.total > 0 && <>
            <Button type="button" size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => requeue(null)}>
                {busy === 'all' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Antre ulang semua yang gagal dipindai</Button>
            <ul className="space-y-2">{list.files.map(file => <li key={file.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
                <div className="min-w-0"><p className="break-words font-medium">{file.fileName || 'Berkas tanpa nama'}</p>
                    <p className="text-xs text-muted-foreground">{sourceLabels[file.entityType] || 'Dokumen lain'} · diunggah {timestamp(file.uploadedAt)}</p>
                    {file.contentMismatch && <p className="text-xs text-muted-foreground">Isi berkas tidak cocok dengan catatan saat diunggah. Bila pemindaian ulang gagal lagi, unggah ulang berkasnya.</p>}</div>
                <Button type="button" size="sm" variant="outline" disabled={Boolean(busy)} aria-label={`Antre ulang ${file.fileName || 'berkas tanpa nama'}`} onClick={() => requeue(file)}>
                    {busy === file.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Antre ulang</Button>
            </li>)}</ul>
            {list.total > list.files.length && <p className="text-xs text-muted-foreground">Menampilkan {list.files.length} dari {list.total} berkas yang gagal dipindai.</p>}
        </>}
    </div>;
}

// Super Admin wake for the on-demand scanner. The server records who asked;
// queue and quarantine states are left to the scan itself.
function RunScanner() {
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    const [failure, setFailure] = useState('');
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const run = async () => {
        if (busy) return;
        setBusy(true); setNotice(''); setFailure('');
        try {
            await api.post('/api/operations/scanner-run', {});
            if (mounted.current) setNotice('Pemindai dijalankan. Berkas yang menunggu dipindai dalam beberapa menit; status di halaman ini diperbarui setiap menit.');
        } catch (error) {
            if (mounted.current) setFailure(error?.status === 429 || error?.status === 503 ? (error.message || SCANNER_RUN_FAILED) : SCANNER_RUN_FAILED);
        } finally {
            if (mounted.current) setBusy(false);
        }
    };
    return <div className="space-y-2 rounded-md border bg-muted/20 p-3" role="group" aria-label="Jalankan pemindai">
        <p className="text-muted-foreground">Pemindai berjalan sendiri setelah berkas diunggah. Bila ada berkas yang lama menunggu pemindaian, jalankan pemindai sekarang.</p>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={run}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Jalankan pemindai</Button>
        {notice && <p role="status">{notice}</p>}
        {failure && <p role="alert" className="text-destructive">{failure}</p>}
    </div>;
}

export default function OperationsMonitoring() {
    const [snapshot, setSnapshot] = useState(null);
    // Kept here so the confirmation survives once no failed scan is left.
    const [scanNotice, setScanNotice] = useState('');
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
            if (!controller.signal.aborted) { setSnapshot(result.data); umumkanStatusOperasional(result.data?.status); }
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
                        {check.id === 'scan_queue' && scanNotice && <p role="status">{scanNotice}</p>}
                        {check.id === 'scan_queue' && check.counts?.errors > 0 && <FailedScans checkedAt={snapshot.timestamp} onChanged={refresh} onNotice={setScanNotice} />}
                        {check.id === 'scanner' && check.status !== 'disabled' && <RunScanner />}
                        {check.id === 'upload_cleanup' && check.status !== 'disabled' && <p className="text-xs text-muted-foreground">Berkas yang diunggah tetapi tidak jadi disimpan pada surat atau arsip dihapus otomatis setiap hari setelah masa tunggunya habis. Bila angka ini tidak turun dalam beberapa hari, hubungi pengelola sistem.</p>}
                        {check.checkedAt && <p className="text-xs text-muted-foreground">Bukti terakhir: {timestamp(check.checkedAt)}</p>}
                        {check.expiresAt && <p className="text-xs text-muted-foreground">Berlaku hingga: {timestamp(check.expiresAt)}</p>}
                    </CardContent>
                </Card>)}
            </div>
            <p className="text-xs text-muted-foreground">Status diperbarui setiap menit saat halaman aktif. Uji pemulihan mencakup database dan berkas dokumen; bukti yang belum lengkap ditandai untuk ditindaklanjuti.</p>
        </>}
    </section>;
}
