
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle, XCircle, Printer, Stamp, FileText, User, Calendar, MessageSquare, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { layananArsipService } from '@/services/layanan-arsip.service';
import { format } from 'date-fns';
import { id as idLocale } from 'date-fns/locale';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter,
} from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';

export default function LayananArsipDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { toast } = useToast();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState(null);
    const [processing, setProcessing] = useState(false);

    // Approval state
    const [notes, setNotes] = useState('');
    const [actionType, setActionType] = useState(null); // 'approve' | 'reject' | 'complete'
    const [isDialogOpen, setIsDialogOpen] = useState(false);

    useEffect(() => {
        fetchDetail();
    }, [id]);

    const fetchDetail = async () => {
        setLoading(true);
        try {
            const result = await layananArsipService.getById(id);
            setData(result.data);
        } catch (error) {
            console.error(error);
            toast({ title: "Error", description: "Gagal memuat detail", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    const handleAction = async () => {
        if (!actionType) return;

        setProcessing(true);
        try {
            let status = 'diproses';
            if (actionType === 'reject') status = 'ditolak';
            if (actionType === 'complete') status = 'selesai';
            // If currently 'diajukan' and action is 'approve', set to 'diproses'
            // If currently 'diproses' and action is 'approve' (complete), set to 'selesai'

            await layananArsipService.updateStatus(id, status, notes);
            toast({ title: "Sukses", description: "Status berhasil diperbarui" });
            fetchDetail();
            setIsDialogOpen(false);
        } catch (error) {
            toast({ title: "Error", description: "Gagal memperbarui status", variant: "destructive" });
        } finally {
            setProcessing(false);
        }
    };

    const openDialog = (type) => {
        setActionType(type);
        setNotes('');
        setIsDialogOpen(true);
    };

    if (loading) return <div>Loading...</div>;
    if (!data) return <div>Data tidak ditemukan</div>;

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" onClick={() => navigate('/layanan-arsip')}>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Kembali
                </Button>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Detail Permohonan</h1>
                    <div className="flex items-center gap-2 text-muted-foreground mt-1">
                        <Badge variant="outline">{data.status.toUpperCase()}</Badge>
                        <span>•</span>
                        <span>{format(new Date(data.createdAt), 'dd MMMM yyyy HH:mm', { locale: idLocale })}</span>
                    </div>
                </div>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
                <div className="md:col-span-2 space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Informasi Layanan</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label className="text-muted-foreground">Jenis Layanan</Label>
                                    <div className="flex items-center gap-2 mt-1 font-medium capitalize">
                                        {data.jenisLayanan === 'legalisasi' ? <Stamp className="h-4 w-4" /> : <Printer className="h-4 w-4" />}
                                        {data.jenisLayanan}
                                    </div>
                                </div>
                                <div>
                                    <Label className="text-muted-foreground">Jumlah Rangkap</Label>
                                    <div className="mt-1 font-medium">{data.jumlahRangkap} Eksemplar</div>
                                </div>
                            </div>

                            <Separator />

                            <div>
                                <Label className="text-muted-foreground">Keperluan</Label>
                                <p className="mt-1">{data.keperluan}</p>
                            </div>

                            {data.keterangan && (
                                <div>
                                    <Label className="text-muted-foreground">Keterangan Tambahan</Label>
                                    <p className="mt-1 text-sm">{data.keterangan}</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Arsip yang Dimohonkan</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="bg-muted/30 p-4 rounded-lg border">
                                <div className="flex items-start gap-3">
                                    <FileText className="h-5 w-5 mt-1 text-primary" />
                                    <div>
                                        <div className="font-semibold text-lg">{data.arsip?.nomorBerkas}</div>
                                        <p className="text-muted-foreground">{data.arsip?.uraianBerkas}</p>
                                        <div className="flex gap-4 mt-2 text-sm text-muted-foreground">
                                            <span>Tahun: {data.arsip?.tahun}</span>
                                            <span>Kode: {data.arsip?.kodeKlasifikasi}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* History / Approval Info */}
                    {(data.status !== 'diajukan') && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Catatan Proses</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex items-start gap-4">
                                    <div className="mt-1">
                                        <User className="h-5 w-5 text-muted-foreground" />
                                    </div>
                                    <div>
                                        <div className="font-medium">Diproses oleh: {data.penyetuju?.nama || 'Sistem'}</div>
                                        <div className="text-sm text-muted-foreground">
                                            {data.tanggalPersetujuan && format(new Date(data.tanggalPersetujuan), 'dd MMM yyyy HH:mm', { locale: idLocale })}
                                        </div>
                                    </div>
                                </div>
                                {data.catatanPersetujuan && (
                                    <div className="flex items-start gap-4 p-3 bg-yellow-50 rounded-md">
                                        <MessageSquare className="h-5 w-5 text-yellow-600 mt-0.5" />
                                        <p className="text-sm text-yellow-800">{data.catatanPersetujuan}</p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}
                </div>

                <div className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Pemohon</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                                    {data.pemohon?.nama?.charAt(0)}
                                </div>
                                <div>
                                    <div className="font-medium">{data.pemohon?.nama}</div>
                                    <div className="text-xs text-muted-foreground">NIP. {data.pemohon?.nip || '-'}</div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Tindakan</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {data.status === 'diajukan' && (
                                <>
                                    <Button className="w-full" onClick={() => openDialog('approve')}>
                                        <CheckCircle className="mr-2 h-4 w-4" />
                                        Proses Permohonan
                                    </Button>
                                    <Button variant="destructive" className="w-full" onClick={() => openDialog('reject')}>
                                        <XCircle className="mr-2 h-4 w-4" />
                                        Tolak Permohonan
                                    </Button>
                                </>
                            )}

                            {data.status === 'diproses' && (
                                <Button className="w-full" variant="default" onClick={() => openDialog('complete')}>
                                    <CheckCircle className="mr-2 h-4 w-4" />
                                    Selesaikan Layanan
                                </Button>
                            )}

                            {data.status === 'selesai' && (
                                <div className="bg-green-50 p-3 rounded text-green-700 text-center text-sm font-medium">
                                    Layanan Selesai
                                </div>
                            )}

                            {data.status === 'ditolak' && (
                                <div className="bg-red-50 p-3 rounded text-red-700 text-center text-sm font-medium">
                                    Permohonan Ditolak
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {actionType === 'approve' ? 'Proses Permohonan' :
                                actionType === 'complete' ? 'Selesaikan Layanan' : 'Tolak Permohonan'}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <Label>Catatan / Keterangan</Label>
                        <Textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder={actionType === 'reject' ? "Alasan penolakan..." : "Catatan proses..."}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setIsDialogOpen(false)}>Batal</Button>
                        <Button
                            variant={actionType === 'reject' ? "destructive" : "default"}
                            onClick={handleAction}
                            disabled={processing}
                        >
                            {processing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Konfirmasi
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
