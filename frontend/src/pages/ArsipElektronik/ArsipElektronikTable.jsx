import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { RefreshCw, Eye, Trash2, ChevronUp } from 'lucide-react'
import { STATUS_CONFIG, FORMAT_OPTIONS, MEDIA_OPTIONS, formatFileSize } from './constants'

export default function ArsipElektronikTable({
    data, loading, page, totalPages, total,
    filterFormat, filterStatus, filterMedia,
    onFilterFormatChange, onFilterStatusChange, onFilterMediaChange,
    onPageChange, onOpenVerify, onDelete
}) {
    return (
        <>
            {/* Filters */}
            <Card>
                <CardContent className="pt-6">
                    <div className="flex flex-wrap gap-4">
                        <Select value={filterFormat} onValueChange={(v) => { onFilterFormatChange(v); }}>
                            <SelectTrigger className="w-[140px]"><SelectValue placeholder="Format" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Semua Format</SelectItem>
                                {FORMAT_OPTIONS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <Select value={filterStatus} onValueChange={(v) => { onFilterStatusChange(v); }}>
                            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Semua Status</SelectItem>
                                <SelectItem value="pending">Menunggu</SelectItem>
                                <SelectItem value="verified">Terverifikasi</SelectItem>
                                <SelectItem value="rejected">Ditolak</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select value={filterMedia} onValueChange={(v) => { onFilterMediaChange(v); }}>
                            <SelectTrigger className="w-[140px]"><SelectValue placeholder="Media" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Semua Media</SelectItem>
                                {MEDIA_OPTIONS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <Badge variant="secondary" className="self-center">{total} dokumen</Badge>
                    </div>
                </CardContent>
            </Card>

            {/* Table */}
            <Card>
                <CardContent className="pt-6">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[50px]">No.</TableHead>
                                <TableHead>Format</TableHead>
                                <TableHead>Ukuran</TableHead>
                                <TableHead>Resolusi</TableHead>
                                <TableHead>Media Asal</TableHead>
                                <TableHead>Hash SHA-256</TableHead>
                                <TableHead>Versi</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Tanggal</TableHead>
                                <TableHead className="w-[80px]">Aksi</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={10} className="text-center py-8">
                                        <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2" />
                                        Memuat...
                                    </TableCell>
                                </TableRow>
                            ) : data.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                                        Tidak ada data arsip elektronik
                                    </TableCell>
                                </TableRow>
                            ) : data.map((item, index) => {
                                const status = STATUS_CONFIG[item.statusVerifikasi] || STATUS_CONFIG.pending
                                return (
                                    <TableRow key={item.id}>
                                        <TableCell>{(page - 1) * 20 + index + 1}</TableCell>
                                        <TableCell><Badge variant="outline">{item.formatFile}</Badge></TableCell>
                                        <TableCell className="text-xs">{formatFileSize(item.ukuranFile)}</TableCell>
                                        <TableCell className="text-xs">{item.resolusiDPI ? `${item.resolusiDPI} DPI` : '-'}</TableCell>
                                        <TableCell className="text-xs">{item.mediaAsal}</TableCell>
                                        <TableCell className="font-mono text-xs max-w-[120px] truncate" title={item.hashSHA256}>
                                            {item.hashSHA256 ? item.hashSHA256.substring(0, 12) + '...' : '-'}
                                        </TableCell>
                                        <TableCell>v{item.versiDokumen}</TableCell>
                                        <TableCell>
                                            <Badge variant={status.variant} className="gap-1">
                                                <status.icon className="h-3 w-3" />
                                                {status.label}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-xs">
                                            {item.tanggalDigitalisasi || new Date(item.createdAt).toLocaleDateString('id-ID')}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex gap-1">
                                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onOpenVerify(item)}>
                                                    <Eye className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onDelete(item.id)}>
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-end gap-2">
                    <span className="text-sm text-muted-foreground">Halaman {page} dari {totalPages}</span>
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
                        <ChevronUp className="h-4 w-4 rotate-[-90deg]" /> Prev
                    </Button>
                    <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
                        Next <ChevronUp className="h-4 w-4 rotate-90" />
                    </Button>
                </div>
            )}
        </>
    )
}
