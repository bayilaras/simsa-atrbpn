import { useCallback, useEffect, useState } from 'react';
import { CloudCog, RefreshCw, RotateCcw, Send } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import srikandiService from '@/services/srikandi.service';

const STATUS = {
    pending: ['Menunggu', 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'],
    processing: ['Diproses', 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300'],
    retry_scheduled: ['Retry terjadwal', 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300'],
    succeeded: ['Tersinkron resmi', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'],
    dead_letter: ['Dead letter', 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300'],
};

function formatDate(value) {
    return value ? new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

export default function SrikandiIntegration() {
    const { user } = useAuth();
    const { toast } = useToast();
    const isSuperAdmin = user?.role === 'super_admin';
    const [configuration, setConfiguration] = useState(null);
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [workingId, setWorkingId] = useState(null);
    const [statusFilter, setStatusFilter] = useState('all');
    const [unitKerjaId, setUnitKerjaId] = useState(user?.unitKerjaId || '');
    const [retryItem, setRetryItem] = useState(null);
    const [retryReason, setRetryReason] = useState('');

    const load = useCallback(async () => {
        try {
            setLoading(true);
            const params = { limit: 100 };
            if (statusFilter !== 'all') params.status = statusFilter;
            if (unitKerjaId) params.unitKerjaId = unitKerjaId;
            const [statusResponse, outboxResponse] = await Promise.all([
                srikandiService.status(),
                srikandiService.list(params),
            ]);
            setConfiguration(statusResponse.data);
            setRows(outboxResponse.data || []);
        } catch (error) {
            toast({ title: 'Gagal memuat integrasi SRIKANDI', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [statusFilter, unitKerjaId, toast]);

    useEffect(() => {
        load();
    }, [load]);

    const dispatch = async (item) => {
        try {
            setWorkingId(item.id);
            const response = await srikandiService.dispatch(item.id, isSuperAdmin ? item.unitKerjaId : unitKerjaId);
            toast({
                title: response.synchronized ? 'Sinkronisasi dikonfirmasi' : 'Belum tersinkron',
                description: response.message,
                variant: response.synchronized ? 'default' : 'destructive',
            });
            await load();
        } catch (error) {
            toast({ title: 'Pengiriman gagal', description: error.message, variant: 'destructive' });
        } finally {
            setWorkingId(null);
        }
    };

    const dispatchDue = async () => {
        // Non-super-admin scope is derived authoritatively by the backend from
        // the role/session even when the legacy account has no explicit unit
        // value. Only a super admin must choose the concrete bulk target.
        if (isSuperAdmin && !unitKerjaId) {
            toast({ title: 'Unit kerja wajib dipilih', description: 'Bulk dispatch selalu dibatasi ke satu unit.', variant: 'destructive' });
            return;
        }
        try {
            setWorkingId('bulk');
            const response = await srikandiService.dispatchDue(unitKerjaId, 1);
            toast({ title: 'Pemrosesan outbox selesai', description: response.message });
            await load();
        } catch (error) {
            toast({ title: 'Pemrosesan gagal', description: error.message, variant: 'destructive' });
        } finally {
            setWorkingId(null);
        }
    };

    const retry = async () => {
        if (!retryItem) return;
        try {
            setWorkingId(retryItem.id);
            const response = await srikandiService.retry(
                retryItem.id,
                isSuperAdmin ? retryItem.unitKerjaId : unitKerjaId,
                retryReason,
            );
            setRetryItem(null);
            setRetryReason('');
            toast({ title: 'Retry dijadwalkan', description: response.message });
            await load();
        } catch (error) {
            toast({ title: 'Retry gagal', description: error.message, variant: 'destructive' });
        } finally {
            setWorkingId(null);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-bold"><CloudCog className="h-6 w-6 text-primary" /> Integrasi SRIKANDI</h1>
                    <p className="mt-1 text-muted-foreground">Outbox, retry, dead-letter, dan bukti pengakuan resmi.</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={load} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" /> Muat ulang</Button>
                    <Button onClick={dispatchDue} disabled={!configuration?.ready || workingId === 'bulk'}><Send className="mr-2 h-4 w-4" /> Proses 1 pesan</Button>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Status konfigurasi</CardTitle>
                    <CardDescription>Nilai endpoint dan kredensial tidak pernah ditampilkan pada halaman ini.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {[
                        ['Outbound aktif', configuration?.enabled],
                        ['Siap dikirim', configuration?.ready],
                        ['Endpoint', configuration?.endpointConfigured],
                        ['Kontrak respons', configuration?.contractConfigured],
                    ].map(([label, value]) => (
                        <div key={label} className="rounded-lg border p-3">
                            <div className="text-sm text-muted-foreground">{label}</div>
                            <Badge className={value ? 'mt-2 bg-emerald-100 text-emerald-800' : 'mt-2 bg-slate-100 text-slate-700'}>{value ? 'Ya' : 'Belum'}</Badge>
                        </div>
                    ))}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Outbox sinkronisasi</CardTitle>
                    <CardDescription>HTTP 2xx tidak ditampilkan sebagai sukses tanpa ACK dan ID resmi sesuai kontrak.</CardDescription>
                    <div className="flex flex-col gap-3 pt-3 sm:flex-row">
                        {isSuperAdmin && <Input value={unitKerjaId} onChange={(event) => setUnitKerjaId(event.target.value.trim())} placeholder="Filter/unit kerja untuk bulk dispatch" className="sm:max-w-xs" />}
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger className="sm:w-56"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Semua status</SelectItem>
                                {Object.entries(STATUS).map(([value, config]) => <SelectItem key={value} value={value}>{config[0]}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                </CardHeader>
                <CardContent>
                    {!rows.length ? (
                        <div className="py-10 text-center text-sm text-muted-foreground">{loading ? 'Memuat outbox…' : 'Belum ada pesan pada cakupan ini.'}</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader><TableRow><TableHead>Waktu / unit</TableHead><TableHead>Peristiwa</TableHead><TableHead>Status</TableHead><TableHead>Percobaan</TableHead><TableHead>Respons</TableHead><TableHead className="text-right">Tindakan</TableHead></TableRow></TableHeader>
                                <TableBody>
                                    {rows.map((item) => {
                                        const status = STATUS[item.status] || [item.status, ''];
                                        return (
                                            <TableRow key={item.id}>
                                                <TableCell><div>{formatDate(item.createdAt)}</div><div className="text-xs text-muted-foreground">{item.unitKerjaId}</div></TableCell>
                                                <TableCell><div className="font-medium">{item.eventType}</div><div className="max-w-56 truncate font-mono text-xs text-muted-foreground" title={item.sourceEntityId}>{item.sourceEntityType}:{item.sourceEntityId}</div></TableCell>
                                                <TableCell><Badge className={status[1]}>{status[0]}</Badge><div className="mt-1 text-xs text-muted-foreground">Berikutnya: {formatDate(item.nextAttemptAt)}</div></TableCell>
                                                <TableCell>{item.attemptCount}/{item.maxAttempts}</TableCell>
                                                <TableCell className="max-w-64"><div className="truncate text-sm" title={item.lastError || item.remoteId || ''}>{item.remoteId ? `ID: ${item.remoteId}` : item.lastError || 'Belum ada respons resmi'}</div></TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end gap-2">
                                                        {['pending', 'retry_scheduled'].includes(item.status) && <Button size="sm" variant="outline" disabled={!configuration?.ready || workingId === item.id} onClick={() => dispatch(item)}><Send className="mr-1 h-3.5 w-3.5" /> Kirim</Button>}
                                                        {item.status === 'dead_letter' && <Button size="sm" variant="outline" disabled={workingId === item.id} onClick={() => setRetryItem(item)}><RotateCcw className="mr-1 h-3.5 w-3.5" /> Retry</Button>}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Dialog open={Boolean(retryItem)} onOpenChange={(open) => !open && setRetryItem(null)}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Jadwalkan ulang pesan</DialogTitle><DialogDescription>Alasan operasional disimpan pada audit append-only. Retry belum berarti tersinkron.</DialogDescription></DialogHeader>
                    <div className="space-y-2"><Label>Alasan retry</Label><Textarea rows={4} value={retryReason} onChange={(event) => setRetryReason(event.target.value)} placeholder="Minimal 10 karakter." /></div>
                    <DialogFooter><Button variant="outline" onClick={() => setRetryItem(null)}>Batal</Button><Button disabled={retryReason.trim().length < 10 || Boolean(workingId)} onClick={retry}>Jadwalkan retry</Button></DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
