import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileCheck, Plus, Search, Download, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { usePaginatedResource } from '@/hooks/use-paginated-resource';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { ResourcePagination } from '@/components/ResourcePagination';
import { autentikasiService } from '@/services/autentikasi.service';
import { useToast } from "@/hooks/use-toast";
import { Badge } from '@/components/ui/badge';

const PAGE_SIZE = 20;

export default function AutentikasiIndex() {
    const [searchTerm, setSearchTerm] = useState('');
    const search = useDebouncedValue(searchTerm.trim(), 300);
    const { toast } = useToast();

    // The server pages and searches; a page belongs to its search, so a late
    // response for an older query cannot replace the current one.
    const fetchPage = useCallback(({ page, limit }) => autentikasiService.getAll({
        search: search || undefined,
        page,
        limit,
    }), [search]);
    const resource = usePaginatedResource(fetchPage, { queryKey: search, pageSize: PAGE_SIZE });
    const { rows: currentData, page: currentPage, loading, error } = resource;

    const handleDownload = async (id) => {
        try {
            const pdf = await autentikasiService.getPdf(id);
            const url = URL.createObjectURL(pdf);
            const link = document.createElement('a');
            link.href = url;
            link.download = `berita-acara-autentikasi-${id}.pdf`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        } catch {
            toast({
                title: "Error",
                description: "Gagal mengunduh dokumen",
                variant: "destructive"
            });
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <FileCheck className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                        Autentikasi Alih Media
                    </h1>
                    <p className="text-muted-foreground">
                        Kelola Berita Acara Autentikasi Arsip Hasil Alih Media
                    </p>
                </div>
                <Link to="/autentikasi/create">
                    <Button>
                        <Plus className="mr-2 h-4 w-4" />
                        Buat Autentikasi Baru
                    </Button>
                </Link>
            </div>

            <Card>
                <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <CardTitle>Daftar Autentikasi</CardTitle>
                        <div className="relative w-72">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                placeholder="Cari nomor berita acara..."
                                className="pl-9"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center py-8">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    ) : error ? null : (
                        <>
                            <Table responsive>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>No.</TableHead>
                                        <TableHead>Nomor Berita Acara</TableHead>
                                        <TableHead>Tanggal</TableHead>
                                        <TableHead>Kegiatan</TableHead>
                                        <TableHead>Jumlah Arsip</TableHead>
                                        <TableHead>Petugas</TableHead>
                                        <TableHead>Aksi</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {currentData.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                                                Belum ada data autentikasi
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        currentData.map((item, index) => (
                                            <TableRow key={item.id}>
                                                <TableCell data-label="No.">{(currentPage - 1) * PAGE_SIZE + index + 1}</TableCell>
                                                <TableCell data-label="Nomor Berita Acara" className="font-medium">{item.nomorBeritaAcara}</TableCell>
                                                <TableCell data-label="Tanggal">
                                                    {new Date(item.tanggalAutentikasi).toLocaleDateString('id-ID', {
                                                        day: 'numeric', month: 'long', year: 'numeric'
                                                    })}
                                                </TableCell>
                                                <TableCell data-label="Kegiatan">{item.kegiatan}</TableCell>
                                                <TableCell data-label="Jumlah Arsip">
                                                    <Badge variant="secondary">
                                                        {item.jumlahArsip} Arsip
                                                    </Badge>
                                                </TableCell>
                                                <TableCell data-label="Petugas">{item.petugas?.name || item.petugas?.nama || '-'}</TableCell>
                                                <TableCell data-label="Aksi">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => handleDownload(item.id)}
                                                    >
                                                        <Download className="h-4 w-4 mr-2" />
                                                        Unduh BA
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </>
                    )}
                    <ResourcePagination resource={resource} label="autentikasi" />
                </CardContent>
            </Card>
        </div>
    );
}
