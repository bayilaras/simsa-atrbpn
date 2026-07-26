import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileCheck, ArrowLeft, Loader2, Save } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from "@/hooks/use-toast";
import { autentikasiService } from '@/services/autentikasi.service';
import { arsipService } from '@/services/arsip.service';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';

export default function AutentikasiCreate() {
    const navigate = useNavigate();
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [archives, setArchives] = useState([]);
    const [selectedArchives, setSelectedArchives] = useState([]);
    const [loadingArchives, setLoadingArchives] = useState(true);

    const [formData, setFormData] = useState({
        nomorBeritaAcara: '',
        tanggalAutentikasi: new Date().toISOString().split('T')[0],
        kegiatan: '',
        tempatDilakukan: 'Kantor Pertanahan',
        jabatanPenandaTangan: 'Kepala Kantor',
    });

    useEffect(() => {
        fetchEligibleArchives();
    }, []);

    const fetchEligibleArchives = async () => {
        setLoadingArchives(true);
        try {
            // Ideally we filter by 'ready for auth' (has electronic file but no auth ID)
            // For now fetching all and filtering client side if needed, or assume user selects relevant ones
            // We'll set a high limit
            const result = await arsipService.getAll({ limit: 100 });
            setArchives(result.data || []);
        } catch (error) {
            console.error(error);
            toast({
                title: "Error",
                description: "Gagal memuat daftar arsip",
                variant: "destructive"
            });
        } finally {
            setLoadingArchives(false);
        }
    };

    const handleSelectArchive = (id, checked) => {
        if (checked) {
            setSelectedArchives([...selectedArchives, id]);
        } else {
            setSelectedArchives(selectedArchives.filter(docId => docId !== id));
        }
    };

    const handleSelectAll = (checked) => {
        if (checked) {
            setSelectedArchives(archives.map(a => a.id));
        } else {
            setSelectedArchives([]);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (selectedArchives.length === 0) {
            toast({
                title: "Peringatan",
                description: "Pilih minimal satu arsip untuk diautentikasi",
                variant: "warning"
            });
            return;
        }

        setLoading(true);
        try {
            await autentikasiService.create({
                ...formData,
                itemArsipIds: selectedArchives
            });

            toast({
                title: "Sukses",
                description: "Berita Acara Autentikasi berhasil dibuat",
                variant: "default"
            });

            navigate('/autentikasi');
        } catch (error) {
            console.error(error);
            toast({
                title: "Error",
                description: error.response?.data?.message || "Gagal membuat autentikasi",
                variant: "destructive"
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6 max-w-5xl mx-auto">
            <div className="flex items-center gap-4">
                <Button variant="ghost" onClick={() => navigate('/autentikasi')}>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Kembali
                </Button>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Buat Autentikasi Baru</h1>
                    <p className="text-muted-foreground">Isi detail Berita Acara dan pilih arsip yang akan diautentikasi</p>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Data Berita Acara</CardTitle>
                    </CardHeader>
                    <CardContent className="grid md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <Label htmlFor="nomor">Nomor Berita Acara</Label>
                            <Input
                                id="nomor"
                                required
                                value={formData.nomorBeritaAcara}
                                onChange={e => setFormData({ ...formData, nomorBeritaAcara: e.target.value })}
                                placeholder="Contoh: 01/BA-AUT/II/2026"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="tanggal">Tanggal Autentikasi</Label>
                            <Input
                                id="tanggal"
                                type="date"
                                required
                                value={formData.tanggalAutentikasi}
                                onChange={e => setFormData({ ...formData, tanggalAutentikasi: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="kegiatan">Nama Kegiatan</Label>
                            <Input
                                id="kegiatan"
                                required
                                value={formData.kegiatan}
                                onChange={e => setFormData({ ...formData, kegiatan: e.target.value })}
                                placeholder="Contoh: Alih Media Arsip Warkah Tahun 2024"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="tempat">Tempat Dilakukan</Label>
                            <Input
                                id="tempat"
                                value={formData.tempatDilakukan}
                                onChange={e => setFormData({ ...formData, tempatDilakukan: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="jabatan">Jabatan Penanda Tangan (Mengetahui)</Label>
                            <Input
                                id="jabatan"
                                value={formData.jabatanPenandaTangan}
                                onChange={e => setFormData({ ...formData, jabatanPenandaTangan: e.target.value })}
                            />
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Pilih Arsip</CardTitle>
                        <CardDescription>
                            Pilih arsip yang telah dialihmedia untuk dimasukkan ke dalam Berita Acara ini.
                            ({selectedArchives.length} terpilih)
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {loadingArchives ? (
                            <div className="flex justify-center p-8">
                                <Loader2 className="h-8 w-8 animate-spin" />
                            </div>
                        ) : (
                            <div className="rounded-md border">
                                <Table responsive>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-12">
                                                <Checkbox
                                                    checked={selectedArchives.length === archives.length && archives.length > 0}
                                                    onCheckedChange={handleSelectAll}
                                                />
                                            </TableHead>
                                            <TableHead>Nomor Berkas</TableHead>
                                            <TableHead>Uraian</TableHead>
                                            <TableHead>Tahun</TableHead>
                                            <TableHead>Jenis</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {archives.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                                                    Tidak ada arsip tersedia
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            archives.map(archive => (
                                                <TableRow key={archive.id}>
                                                    <TableCell>
                                                        <Checkbox
                                                            checked={selectedArchives.includes(archive.id)}
                                                            onCheckedChange={(checked) => handleSelectArchive(archive.id, checked)}
                                                        />
                                                    </TableCell>
                                                    <TableCell data-label="Nomor Berkas" className="font-medium">{archive.nomorBerkas}</TableCell>
                                                    <TableCell data-label="Uraian" className="max-w-xs truncate">{archive.uraianBerkas}</TableCell>
                                                    <TableCell data-label="Tahun">{archive.tahun}</TableCell>
                                                    <TableCell data-label="Jenis">{archive.jenisArsip}</TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </CardContent>
                </Card>

                <div className="flex justify-end gap-4">
                    <Button type="button" variant="outline" onClick={() => navigate('/autentikasi')}>
                        Batal
                    </Button>
                    <Button type="submit" disabled={loading || selectedArchives.length === 0}>
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Simpan & Generate Berita Acara
                    </Button>
                </div>
            </form>
        </div>
    );
}
