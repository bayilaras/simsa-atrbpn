import { useContext, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import AuthContext from '@/context/AuthContext';
import { useAppConfig } from '@/context/app-config-context';
import api from '@/services/api';

const UPLOAD_TYPES = { surat_masuk: 'masuk', surat_keluar: 'keluar', arsip: 'arsip' };

export function FileScanStatus({ entityType, entityId, status, onRefresh }) {
    const auth = useContext(AuthContext);
    const { capabilities } = useAppConfig();
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const blocked = status === 'infected' || status === 'scan_error';
    const clean = status === 'clean';
    const pending = status === 'not_scanned' || /^(?:scanning|retry):[1-9]\d*:\d+$/.test(status || '');
    const uploadType = UPLOAD_TYPES[entityType];
    const retryAllowed = pending && uploadType && capabilities.fileUploads && auth?.canWrite?.();

    const run = async (retry) => {
        if (busy) return;
        setBusy(true);
        setError('');
        setMessage('');
        try {
            if (retry) {
                await api.post(`/api/upload/${uploadType}/${encodeURIComponent(entityId)}/scan`, {});
                setMessage('Pemeriksaan dijadwalkan. Tunggu sebentar, lalu periksa status kembali.');
            } else {
                await onRefresh?.();
            }
        } catch (failure) {
            setError(failure.message || 'Status pemeriksaan belum dapat diperbarui.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-2 rounded-md border bg-muted/20 p-3 text-sm">
            <p role="status">{clean ? 'Dokumen telah lolos pemeriksaan antivirus.'
                : blocked ? 'Dokumen belum dapat digunakan. Hubungi pengelola untuk memeriksa atau mengganti berkas.'
                    : pending ? 'Dokumen tersimpan dan menunggu pemeriksaan. Pratinjau dan unduhan tersedia setelah dokumen dinyatakan aman dan utuh.'
                        : 'Status pemeriksaan dokumen belum dapat dipastikan. Periksa status kembali; jika tetap tidak dapat dibuka, hubungi pengelola.'}</p>
            {message && pending && <p role="status">{message}</p>}
            {error && <p role="alert" className="text-destructive">{error}</p>}
            {!clean && <div className="flex flex-wrap gap-2">
                {onRefresh && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => run(false)}>Periksa status</Button>}
                {retryAllowed && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => run(true)}>
                    {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Lanjutkan pemeriksaan
                </Button>}
            </div>}
        </div>
    );
}
