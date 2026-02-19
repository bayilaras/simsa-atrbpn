import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'
import {
    Pagination, PaginationContent, PaginationItem,
    PaginationNext, PaginationPrevious,
} from '@/components/ui/pagination'
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RefreshCw, Search, Eye, Trash2, Send } from 'lucide-react'
import { KATEGORI_CONFIG, STATUS_PELAPORAN_CONFIG, STATUS_KEPATUHAN_CONFIG } from './constants'

export default function ArsipTerjagaTable({
    data, loading, page, totalPages, search, filterKategori, filterPelaporan,
    onSearchChange, onFilterKategoriChange, onFilterPelaporanChange,
    onPageChange, onRefresh, onOpenDetail, onOpenReport, onDelete
}) {
    return (
        <div className="space-y-4">
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Cari arsip terjaga..."
                        value={search}
                        onChange={e => onSearchChange(e.target.value)}
                        className="pl-9"
                    />
                </div>
                <Select value={filterKategori} onValueChange={v => onFilterKategoriChange(v === 'all' ? '' : v)}>
                    <SelectTrigger className="w-[200px]"><SelectValue placeholder="Semua Kategori" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Semua Kategori</SelectItem>
                        {Object.entries(KATEGORI_CONFIG).map(([k, v]) => (
                            <SelectItem key={k} value={k}>{v.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Select value={filterPelaporan} onValueChange={v => onFilterPelaporanChange(v === 'all' ? '' : v)}>
                    <SelectTrigger className="w-[200px]"><SelectValue placeholder="Semua Status" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Semua Status</SelectItem>
                        {Object.entries(STATUS_PELAPORAN_CONFIG).map(([k, v]) => (
                            <SelectItem key={k} value={k}>{v.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Button variant="outline" size="icon" onClick={onRefresh}>
                    <RefreshCw className="h-4 w-4" />
                </Button>
            </div>

            {/* Table */}
            <div className="rounded-md border bg-card">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-12 text-center">No</TableHead>
                            <TableHead>Nomor & Uraian Berkas</TableHead>
                            <TableHead>Kategori</TableHead>
                            <TableHead>Status Pelaporan</TableHead>
                            <TableHead>No. Laporan ANRI</TableHead>
                            <TableHead>Kepatuhan</TableHead>
                            <TableHead className="w-[100px] text-right">Aksi</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={7} className="text-center py-8">
                                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                                        <RefreshCw className="h-6 w-6 animate-spin" />
                                        <p>Memuat data...</p>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : data.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                                    <div className="flex flex-col items-center gap-2">
                                        <div className="p-3 bg-muted rounded-full">
                                            <Search className="h-6 w-6" />
                                        </div>
                                        <p>Belum ada arsip terjaga yang ditetapkan</p>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : data.map((item, idx) => {
                            const kat = KATEGORI_CONFIG[item.kategoriTerjaga] || {}
                            const sp = STATUS_PELAPORAN_CONFIG[item.statusPelaporan] || {}
                            const sk = STATUS_KEPATUHAN_CONFIG[item.statusKepatuhan] || {}
                            return (
                                <TableRow key={item.id} className="hover:bg-muted/50">
                                    <TableCell className="text-center">{(page - 1) * 10 + idx + 1}</TableCell>
                                    <TableCell>
                                        <div className="font-medium text-purple-700">{item.nomorBerkas || '-'}</div>
                                        <div className="text-sm text-muted-foreground max-w-[300px] truncate" title={item.uraianBerkas || item.perihalOriginal}>
                                            {item.uraianBerkas || item.perihalOriginal || '-'}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className={`font-normal ${kat.color}`}>
                                            {kat.label || item.kategoriTerjaga}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className={`font-normal ${sp.color}`}>
                                            {sp.label || item.statusPelaporan}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-sm font-mono text-muted-foreground">
                                        {item.nomorLaporanANRI || '-'}
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className={`font-normal ${sk.color}`}>
                                            {sk.label || item.statusKepatuhan}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-1">
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onOpenDetail(item)}>
                                                <Eye className="h-4 w-4" />
                                            </Button>
                                            {item.statusPelaporan === 'belum_dilaporkan' && (
                                                <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50" onClick={() => onOpenReport(item)}>
                                                    <Send className="h-4 w-4" />
                                                </Button>
                                            )}
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => onDelete(item.id)}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            )
                        })}
                    </TableBody>
                </Table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <Pagination>
                    <PaginationContent>
                        <PaginationItem>
                            <PaginationPrevious onClick={() => onPageChange(Math.max(1, page - 1))} className={page === 1 ? 'pointer-events-none opacity-50' : ''} />
                        </PaginationItem>
                        <PaginationItem>
                            <span className="text-sm px-4 py-2">Halaman {page} dari {totalPages}</span>
                        </PaginationItem>
                        <PaginationItem>
                            <PaginationNext onClick={() => onPageChange(Math.min(totalPages, page + 1))} className={page === totalPages ? 'pointer-events-none opacity-50' : ''} />
                        </PaginationItem>
                    </PaginationContent>
                </Pagination>
            )}
        </div>
    )
}
