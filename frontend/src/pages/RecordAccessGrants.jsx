import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock3, Eye, FileKey2, LockKeyhole, RefreshCw } from 'lucide-react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import recordAccessGrantService from '@/services/record-access-grant.service';

const STATUS = {
    pending: { label: 'Menunggu', className: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
    approved: { label: 'Disetujui', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300' },
    denied: { label: 'Ditolak', className: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300' },
    revoked: { label: 'Dicabut', className: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300' },
    expired: { label: 'Kedaluwarsa', className: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300' },
};

const ENTITY_LABEL = {
    surat_masuk: 'Surat Masuk',
    surat_keluar: 'Surat Keluar',
    arsip: 'Arsip',
};

function formatDate(value) {
    if (!value) return '—';
    return new Date(value).toLocaleString('id-ID', {
        dateStyle: 'medium',
        timeStyle: 'short',
    });
}

function AccessTable({ rows, reviewer, onDecision }) {
    if (!rows.length) {
        return <div className="py-10 text-center text-sm text-muted-foreground">Belum ada permohonan pada daftar ini.</div>;
    }

    return (
        <div className="overflow-x-auto">
            <Table>
                <TableHeader>
                    <TableRow>
                        {reviewer && <TableHead>Pemohon</TableHead>}
                        <TableHead>Rekod</TableHead>
                        <TableHead>Klasifikasi</TableHead>
                        <TableHead>Tujuan / Mode</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Masa berlaku</TableHead>
                        {reviewer && <TableHead className="text-right">Tindakan</TableHead>}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.map((row) => {
                        const status = STATUS[row.status] || { label: row.status, className: '' };
                        return (
                            <TableRow key={row.id}>
                                {reviewer && (
                                    <TableCell>
                                        <div className="font-medium">{row.requesterName || 'Tanpa nama'}</div>
                                        <div className="text-xs text-muted-foreground">{row.requesterEmail}</div>
                                    </TableCell>
                                )}
                                <TableCell>
                                    <div className="font-medium">{ENTITY_LABEL[row.entityType] || row.entityType}</div>
                                    <div className="max-w-[220px] truncate font-mono text-xs text-muted-foreground" title={row.entityId}>{row.entityId}</div>
                                    <div className="text-xs text-muted-foreground">Unit {row.unitKerjaId}</div>
                                </TableCell>
                                <TableCell className="capitalize">{String(row.requiredClassification || '').replace('_', ' ')}</TableCell>
                                <TableCell className="max-w-[320px]">
                                    <div className="whitespace-pre-wrap text-sm">{row.purpose}</div>
                                    <div className="mt-1 text-xs font-medium text-muted-foreground">
                                        {row.accessMode === 'download'
                                            ? 'Tayang dan unduh'
                                            : row.accessMode === 'manage'
                                                ? 'Tayang dan kelola (tanpa unduh)'
                                                : 'Tayang saja'}
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <Badge className={status.className}>{status.label}</Badge>
                                    <div className="mt-1 text-xs text-muted-foreground">{formatDate(row.requestedAt)}</div>
                                </TableCell>
                                <TableCell>{formatDate(row.expiresAt)}</TableCell>
                                {reviewer && (
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            {row.status === 'pending' && (
                                                <>
                                                    <Button size="sm" onClick={() => onDecision('approve', row)}>Setujui</Button>
                                                    <Button size="sm" variant="destructive" onClick={() => onDecision('deny', row)}>Tolak</Button>
                                                </>
                                            )}
                                            {row.status === 'approved' && (
                                                <Button size="sm" variant="outline" onClick={() => onDecision('revoke', row)}>Cabut</Button>
                                            )}
                                        </div>
                                    </TableCell>
                                )}
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
}

export default function RecordAccessGrants() {
    const { user } = useAuth();
    const { toast } = useToast();
    const canReview = user?.role === 'super_admin';
    const [mine, setMine] = useState([]);
    const [review, setReview] = useState([]);
    const [loading, setLoading] = useState(true);
    const [requestOpen, setRequestOpen] = useState(false);
    const [decision, setDecision] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [requestForm, setRequestForm] = useState({
        entityType: 'arsip',
        entityId: '',
        purpose: '',
        accessMode: 'view',
    });
    const [decisionReason, setDecisionReason] = useState('');
    const [expiresAt, setExpiresAt] = useState('');

    const defaultExpiry = useMemo(() => {
        const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
        return local.toISOString().slice(0, 16);
    }, []);

    const load = useCallback(async () => {
        try {
            setLoading(true);
            const [mineResponse, pendingResponse, approvedResponse] = await Promise.all([
                recordAccessGrantService.listMine({ limit: 100 }),
                canReview
                    ? recordAccessGrantService.listForReview({ limit: 100, status: 'pending' })
                    : Promise.resolve({ data: [] }),
                canReview
                    ? recordAccessGrantService.listForReview({ limit: 100, status: 'approved' })
                    : Promise.resolve({ data: [] }),
            ]);
            setMine(mineResponse.data || []);
            setReview([...(pendingResponse.data || []), ...(approvedResponse.data || [])]);
        } catch (error) {
            toast({ title: 'Gagal memuat persetujuan akses', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [canReview, toast]);

    useEffect(() => {
        load();
    }, [load]);

    const submitRequest = async () => {
        try {
            setSubmitting(true);
            await recordAccessGrantService.request(requestForm);
            setRequestOpen(false);
            setRequestForm({ entityType: 'arsip', entityId: '', purpose: '', accessMode: 'view' });
            toast({ title: 'Permohonan dikirim', description: 'Akses belum aktif sampai disetujui pejabat berwenang.' });
            await load();
        } catch (error) {
            toast({ title: 'Permohonan gagal', description: error.message, variant: 'destructive' });
        } finally {
            setSubmitting(false);
        }
    };

    const openDecision = (action, grant) => {
        setDecision({ action, grant });
        setDecisionReason('');
        setExpiresAt(defaultExpiry);
    };

    const submitDecision = async () => {
        if (!decision) return;
        try {
            setSubmitting(true);
            const payload = { reason: decisionReason };
            if (decision.action === 'approve') {
                payload.expiresAt = new Date(expiresAt).toISOString();
                await recordAccessGrantService.approve(decision.grant.id, payload);
            } else if (decision.action === 'deny') {
                await recordAccessGrantService.deny(decision.grant.id, payload);
            } else {
                await recordAccessGrantService.revoke(decision.grant.id, payload);
            }
            setDecision(null);
            toast({ title: 'Keputusan tersimpan', description: 'Status dan jejak audit akses telah diperbarui.' });
            await load();
        } catch (error) {
            toast({ title: 'Keputusan gagal', description: error.message, variant: 'destructive' });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-bold"><FileKey2 className="h-6 w-6 text-primary" /> Persetujuan Akses Rekod</h1>
                    <p className="mt-1 text-muted-foreground">Need-to-know berbasis tujuan, masa berlaku, dan mode tayang, unduh, atau kelola.</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={load} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" /> Muat ulang</Button>
                    <Button onClick={() => setRequestOpen(true)}><LockKeyhole className="mr-2 h-4 w-4" /> Minta akses</Button>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Kontrol akses berjangka</CardTitle>
                    <CardDescription>Role administratif tidak otomatis membuka bitstream Terbatas, Rahasia, atau Sangat Rahasia. Persetujuan per-rekod tetap diperlukan.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Tabs defaultValue="mine">
                        <TabsList>
                            <TabsTrigger value="mine"><Eye className="mr-2 h-4 w-4" /> Permohonan Saya</TabsTrigger>
                            {canReview && <TabsTrigger value="review"><Clock3 className="mr-2 h-4 w-4" /> Perlu Keputusan ({review.length})</TabsTrigger>}
                        </TabsList>
                        <TabsContent value="mine" className="mt-4">
                            <AccessTable rows={mine} reviewer={false} onDecision={openDecision} />
                        </TabsContent>
                        {canReview && (
                            <TabsContent value="review" className="mt-4">
                                <AccessTable rows={review} reviewer onDecision={openDecision} />
                            </TabsContent>
                        )}
                    </Tabs>
                </CardContent>
            </Card>

            <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Minta akses rekod terkendali</DialogTitle>
                        <DialogDescription>Masukkan ID rekod yang diketahui dan tujuan kedinasan yang dapat diverifikasi.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Jenis rekod</Label>
                            <Select value={requestForm.entityType} onValueChange={(value) => setRequestForm((form) => ({ ...form, entityType: value }))}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="arsip">Arsip</SelectItem>
                                    <SelectItem value="surat_masuk">Surat Masuk</SelectItem>
                                    <SelectItem value="surat_keluar">Surat Keluar</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>ID rekod</Label>
                            <Input value={requestForm.entityId} onChange={(event) => setRequestForm((form) => ({ ...form, entityId: event.target.value.trim() }))} placeholder="UUID rekod" />
                        </div>
                        <div className="space-y-2">
                            <Label>Mode akses</Label>
                            <Select value={requestForm.accessMode} onValueChange={(value) => setRequestForm((form) => ({ ...form, accessMode: value }))}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="view">Tayang saja</SelectItem>
                                    <SelectItem value="download">Tayang dan unduh</SelectItem>
                                    <SelectItem value="manage">Tayang dan kelola (tanpa unduh)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Tujuan kedinasan</Label>
                            <Textarea value={requestForm.purpose} onChange={(event) => setRequestForm((form) => ({ ...form, purpose: event.target.value }))} placeholder="Jelaskan kebutuhan, kegiatan, atau dasar penugasan (minimal 20 karakter)." rows={4} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRequestOpen(false)}>Batal</Button>
                        <Button disabled={submitting || requestForm.purpose.trim().length < 20 || !requestForm.entityId} onClick={submitRequest}>Kirim permohonan</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={Boolean(decision)} onOpenChange={(open) => !open && setDecision(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{decision?.action === 'approve' ? 'Setujui akses' : decision?.action === 'deny' ? 'Tolak akses' : 'Cabut akses'}</DialogTitle>
                        <DialogDescription>Keputusan disimpan permanen bersama pelaku, waktu, alasan, rekod, dan pemohon.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        {decision?.action === 'approve' && (
                            <div className="space-y-2">
                                <Label>Berlaku sampai</Label>
                                <Input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
                                <p className="text-xs text-muted-foreground">Minimal 15 menit dan maksimal 30 hari.</p>
                            </div>
                        )}
                        <div className="space-y-2">
                            <Label>Alasan keputusan</Label>
                            <Textarea value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} rows={4} placeholder="Minimal 10 karakter." />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDecision(null)}>Batal</Button>
                        <Button disabled={submitting || decisionReason.trim().length < 10 || (decision?.action === 'approve' && !expiresAt)} onClick={submitDecision}>Simpan keputusan</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
