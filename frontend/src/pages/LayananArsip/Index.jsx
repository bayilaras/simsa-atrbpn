import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Plus,
    Search,
    FileText,
    Clock,
    CheckCircle2,
    XCircle,
    MoreHorizontal,
    Printer,
    Stamp,
    FileBadge,
    Filter
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { layananArsipService } from '@/services/layanan-arsip.service';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { id as idLocale } from 'date-fns/locale';
import { TableSkeleton } from '@/components/LoadingSkeletons';

export default function LayananArsipIndex() {
    const navigate = useNavigate();
    const { toast } = useToast();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState([]);
    const [statusFilter, setStatusFilter] = useState('all');
    const [myRequests, setMyRequests] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        fetchData();
    }, [statusFilter, myRequests]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const params = {};
            if (statusFilter !== 'all') params.status = statusFilter;
            if (myRequests) params.myRequests = 'true';

            const result = await layananArsipService.getAll(params);
            setData(result.data || []);
        } catch (error) {
            console.error(error);
            toast({
                title: "Error",
                description: "Gagal memuat data layanan",
                variant: "destructive"
            });
        } finally {
            setLoading(false);
        }
    };

    const getStatusBadge = (status) => {
        switch (status) {
            case 'diajukan': return <Badge variant="outline" className="bg-yellow-50 dark:bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-yellow-200 hover:bg-yellow-100 dark:bg-yellow-500/15"><Clock className="w-3 h-3 mr-1" /> Diajukan</Badge>;
            case 'diproses': return <Badge variant="outline" className="bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-200 hover:bg-blue-100 dark:bg-blue-500/15"><Clock className="w-3 h-3 mr-1" /> Diproses</Badge>;
            case 'selesai': return <Badge variant="outline" className="bg-green-50 dark:bg-green-500/15 text-green-700 dark:text-green-300 border-green-200 hover:bg-green-100 dark:bg-green-500/15"><CheckCircle2 className="w-3 h-3 mr-1" /> Selesai</Badge>;
            case 'ditolak': return <Badge variant="destructive" className="hover:bg-destructive/90"><XCircle className="w-3 h-3 mr-1" /> Ditolak</Badge>;
            default: return <Badge variant="outline">{status}</Badge>;
        }
    };

    const getLayananIcon = (jenis) => {
        return jenis === 'legalisasi' ? <Stamp className="h-4 w-4 mr-2 text-indigo-500" /> : <Printer className="h-4 w-4 mr-2 text-orange-500" />;
    };

    // Filter data client-side for search
    const filteredData = data.filter(item => {
        if (!searchQuery) return true;
        const query = searchQuery.toLowerCase();
        return (
            item.arsip?.nomorBerkas?.toLowerCase().includes(query) ||
            item.arsip?.uraianBerkas?.toLowerCase().includes(query) ||
            item.pemohon?.nama?.toLowerCase().includes(query)
        );
    });

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                    <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                        <div className="p-2 bg-indigo-100 dark:bg-indigo-500/15 rounded-lg">
                            <FileBadge className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        Layanan Arsip
                    </h1>
                    <p className="text-muted-foreground">
                        Pengelolaan permohonan penggandaan dan legalisasi arsip
                    </p>
                </div>
                <Button onClick={() => navigate('/layanan-arsip/create')} className="h-9 shadow-sm bg-indigo-600 hover:bg-indigo-700">
                    <Plus className="mr-2 h-4 w-4" />
                    Buat Permohonan
                </Button>
            </div>

            {/* Stats Overview (Optional - can be added if backend supports it) */}

            <Card className="shadow-sm border-border/60">
                <CardHeader className="pb-4 bg-muted/20">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <Tabs defaultValue="all" value={statusFilter} onValueChange={setStatusFilter} className="w-full sm:w-auto">
                            <TabsList className="bg-muted/50 p-1">
                                <TabsTrigger value="all">Semua</TabsTrigger>
                                <TabsTrigger value="diajukan">Baru</TabsTrigger>
                                <TabsTrigger value="diproses">Proses</TabsTrigger>
                                <TabsTrigger value="selesai">Selesai</TabsTrigger>
                            </TabsList>
                        </Tabs>

                        <div className="relative w-full sm:w-72">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Cari nomor berkas, uraian, pemohon..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 bg-background focus:bg-background"
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-muted/50">
                            <TableRow className="hover:bg-transparent">
                                <TableHead className="w-[140px]">Tanggal</TableHead>
                                <TableHead>Jenis Layanan</TableHead>
                                <TableHead>Arsip</TableHead>
                                <TableHead>Pemohon</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Aksi</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="p-0">
                                        <TableSkeleton rows={5} columns={6} />
                                    </TableCell>
                                </TableRow>
                            ) : filteredData.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center py-16 text-muted-foreground">
                                        <div className="p-4 bg-muted/50 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                                            <FileText className="h-8 w-8 opacity-20" />
                                        </div>
                                        <h3 className="text-lg font-medium mb-1">Tidak ada permohonan</h3>
                                        <p className="text-sm opacity-80">Belum ada permohonan layanan arsip yang sesuai filter.</p>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredData.map((item) => (
                                    <TableRow key={item.id} className="group hover:bg-muted/50 transition-colors">
                                        <TableCell className="text-muted-foreground font-medium text-xs">
                                            {format(new Date(item.createdAt), 'dd MMM yyyy, HH:mm', { locale: idLocale })}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center capitalize font-medium text-sm">
                                                {getLayananIcon(item.jenisLayanan)}
                                                {item.jenisLayanan}
                                            </div>
                                        </TableCell>
                                        <TableCell className="max-w-[300px]">
                                            <div className="font-semibold text-sm">{item.arsip?.nomorBerkas || '-'}</div>
                                            <div className="text-xs text-muted-foreground truncate">
                                                {item.arsip?.uraianBerkas}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
                                                    {item.pemohon?.nama?.charAt(0)}
                                                </div>
                                                <span className="text-sm">{item.pemohon?.nama}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            {getStatusBadge(item.status)}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" className="h-8 w-8 p-0">
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuLabel>Aksi</DropdownMenuLabel>
                                                    <DropdownMenuItem onClick={() => navigate(`/layanan-arsip/${item.id}`)}>
                                                        Lihat Detail
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
