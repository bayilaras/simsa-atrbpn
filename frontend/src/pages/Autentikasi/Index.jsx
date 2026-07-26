import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FileCheck, Plus, Search, FileText, Download, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
import { useDataTable } from '@/hooks/use-data-table';
import {
    Pagination,
    PaginationContent,
    PaginationItem,
    PaginationNext,
    PaginationPrevious,
} from "@/components/ui/pagination";
import { autentikasiService } from '@/services/autentikasi.service';
import { useToast } from "@/hooks/use-toast";
import { formatDate } from '@/lib/utils'; // Assuming this utility exists, if not use standard Date
import { Badge } from '@/components/ui/badge';

export default function AutentikasiIndex() {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const { toast } = useToast();

    // Data Table Hook
    const {
        currentData,
        totalPages,
        currentPage,
        goToPage,
        nextPage,
        prevPage,
        canNext,
        canPrev,
    } = useDataTable(data, { pageSize: 10 });

    const fetchData = async () => {
        setLoading(true);
        try {
            const result = await autentikasiService.getAll({
                search: searchTerm,
                page: 1, // backend pagination support could be added to hook later, for now fetching all or let hook handle client side
                limit: 100 // Fetch reasonably large amount or implement server-side pagination with hook
            });
            setData(result.data || []);
        } catch (error) {
            console.error(error);
            toast({
                title: "Error",
                description: "Gagal memuat data autentikasi",
                variant: "destructive"
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [searchTerm]);

    const handleDownload = async (id, nomor) => {
        try {
            const url = await autentikasiService.getPdfUrl(id);
            // Open in new tab
            window.open(url, '_blank');
        } catch (error) {
            toast({
                title: "Error",
                description: "Gagal mengunduh dokumen",
                variant: "destructive"
            });
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
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
                    <div className="flex justify-between items-center">
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
                    ) : (
                        <>
                            <Table>
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
                                                <TableCell>{(currentPage - 1) * 10 + index + 1}</TableCell>
                                                <TableCell className="font-medium">{item.nomorBeritaAcara}</TableCell>
                                                <TableCell>
                                                    {new Date(item.tanggalAutentikasi).toLocaleDateString('id-ID', {
                                                        day: 'numeric', month: 'long', year: 'numeric'
                                                    })}
                                                </TableCell>
                                                <TableCell>{item.kegiatan}</TableCell>
                                                <TableCell>
                                                    <Badge variant="secondary">
                                                        {item.jumlahArsip} Arsip
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>{item.petugas?.nama || '-'}</TableCell>
                                                <TableCell>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => handleDownload(item.id, item.nomorBeritaAcara)}
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

                            {totalPages > 1 && (
                                <div className="flex items-center justify-end space-x-2 mt-4">
                                    <Pagination>
                                        <PaginationContent>
                                            <PaginationItem>
                                                <Button variant="outline" size="sm" onClick={prevPage} disabled={!canPrev}>
                                                    Previous
                                                </Button>
                                            </PaginationItem>
                                            <PaginationItem>
                                                <Button variant="outline" size="sm" onClick={nextPage} disabled={!canNext}>
                                                    Next
                                                </Button>
                                            </PaginationItem>
                                        </PaginationContent>
                                    </Pagination>
                                </div>
                            )}
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
