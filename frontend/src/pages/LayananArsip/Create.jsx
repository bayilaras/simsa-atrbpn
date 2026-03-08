
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { layananArsipService } from '@/services/layanan-arsip.service';
import { arsipService } from '@/services/arsip.service';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";

export default function LayananArsipCreate() {
    const navigate = useNavigate();
    const { toast } = useToast();
    const { user } = useAuth();
    const [loading, setLoading] = useState(false);

    // Form Data
    const [formData, setFormData] = useState({
        jenisLayanan: 'penggandaan', // 'penggandaan' | 'legalisasi'
        arsipId: '',
        jumlahRangkap: 1,
        keperluan: '',
        keterangan: ''
    });

    // Arsip Selection state
    const [selectedArsip, setSelectedArsip] = useState(null);
    const [arsipList, setArsipList] = useState([]);
    const [loadingArsip, setLoadingArsip] = useState(false);
    const [searchArsip, setSearchArsip] = useState('');
    const [isDialogOpen, setIsDialogOpen] = useState(false);

    useEffect(() => {
        if (isDialogOpen) {
            fetchArsip();
        }
    }, [isDialogOpen, searchArsip]);

    const fetchArsip = async () => {
        setLoadingArsip(true);
        try {
            const result = await arsipService.getAll({
                search: searchArsip,
                limit: 10,
                unitKerjaId: user?.unitKerjaId,
            });
            setArsipList(result.data || []);
        } catch (error) {
            console.error(error);
        } finally {
            setLoadingArsip(false);
        }
    };

    const handleSelectArsip = (arsip) => {
        setSelectedArsip(arsip);
        setFormData({ ...formData, arsipId: arsip.id });
        setIsDialogOpen(false);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!formData.arsipId) {
            toast({
                title: "Error",
                description: "Silakan pilih arsip terlebih dahulu",
                variant: "destructive"
            });
            return;
        }

        setLoading(true);
        try {
            await layananArsipService.create(formData);
            toast({
                title: "Sukses",
                description: "Permohonan layanan berhasil diajukan",
            });
            navigate('/layanan-arsip');
        } catch (error) {
            console.error(error);
            toast({
                title: "Error",
                description: "Gagal mengajukan permohonan",
                variant: "destructive"
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" onClick={() => navigate('/layanan-arsip')}>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Kembali
                </Button>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Buat Permohonan Baru</h1>
                    <p className="text-muted-foreground">Ajukan permohonan penggandaan atau legalisasi arsip</p>
                </div>
            </div>

            <form onSubmit={handleSubmit}>
                <Card>
                    <CardHeader>
                        <CardTitle>Formulir Permohonan</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="space-y-2">
                            <Label>Jenis Layanan</Label>
                            <Select
                                value={formData.jenisLayanan}
                                onValueChange={(val) => setFormData({ ...formData, jenisLayanan: val })}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Pilih jenis layanan" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="penggandaan">Penggandaan (Fotokopi/Salinan digital)</SelectItem>
                                    <SelectItem value="legalisasi">Legalisasi (Pengesahan sesuai asli)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>Pilih Arsip</Label>
                            <div className="flex gap-2">
                                <div className="flex-1 p-3 border rounded-md bg-muted/20">
                                    {selectedArsip ? (
                                        <div>
                                            <div className="font-medium">{selectedArsip.nomorBerkas}</div>
                                            <div className="text-sm text-muted-foreground">{selectedArsip.uraianBerkas}</div>
                                            <div className="text-xs text-muted-foreground mt-1">Tahun: {selectedArsip.tahun}</div>
                                        </div>
                                    ) : (
                                        <div className="text-muted-foreground italic">Belum ada arsip dipilih</div>
                                    )}
                                </div>
                                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                                    <DialogTrigger asChild>
                                        <Button type="button" variant="outline">Cari Arsip</Button>
                                    </DialogTrigger>
                                    <DialogContent className="max-w-2xl">
                                        <DialogHeader>
                                            <DialogTitle>Pilih Arsip</DialogTitle>
                                        </DialogHeader>
                                        <div className="space-y-4 py-4">
                                            <Input
                                                placeholder="Cari nomor berkas atau uraian..."
                                                value={searchArsip}
                                                onChange={(e) => setSearchArsip(e.target.value)}
                                            />
                                            <div className="max-h-[300px] overflow-y-auto border rounded-md">
                                                {loadingArsip ? (
                                                    <div className="p-4 text-center">Loading...</div>
                                                ) : arsipList.length === 0 ? (
                                                    <div className="p-4 text-center text-muted-foreground">Tidak ditemukan</div>
                                                ) : (
                                                    <div className="divide-y">
                                                        {arsipList.map(arsip => (
                                                            <div
                                                                key={arsip.id}
                                                                className="p-3 hover:bg-muted cursor-pointer transition-colors"
                                                                onClick={() => handleSelectArsip(arsip)}
                                                            >
                                                                <div className="font-medium">{arsip.nomorBerkas}</div>
                                                                <div className="text-sm">{arsip.uraianBerkas}</div>
                                                                <div className="text-xs text-muted-foreground flex gap-2 mt-1">
                                                                    <span>Tahun: {arsip.tahun}</span>
                                                                    <span>•</span>
                                                                    <span>Unit: {arsip.unitKerja?.nama}</span>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </DialogContent>
                                </Dialog>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Jumlah Rangkap</Label>
                                <Input
                                    type="number"
                                    min="1"
                                    value={formData.jumlahRangkap}
                                    onChange={(e) => setFormData({ ...formData, jumlahRangkap: parseInt(e.target.value) })}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Keperluan</Label>
                            <Textarea
                                placeholder="Jelaskan keperluan pengajuan layanan ini..."
                                value={formData.keperluan}
                                onChange={(e) => setFormData({ ...formData, keperluan: e.target.value })}
                                required
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Keterangan Tambahan (Opsional)</Label>
                            <Textarea
                                placeholder="Catatan tambahan..."
                                value={formData.keterangan}
                                onChange={(e) => setFormData({ ...formData, keterangan: e.target.value })}
                            />
                        </div>

                        <div className="flex justify-end gap-2 pt-4">
                            <Button type="button" variant="ghost" onClick={() => navigate('/layanan-arsip')}>
                                Batal
                            </Button>
                            <Button type="submit" disabled={loading}>
                                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Ajukan Permohonan
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </form>
        </div>
    );
}
