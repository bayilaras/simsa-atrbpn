import { useState, useEffect, useRef } from 'react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Search, Plus, ArrowLeftRight, Loader2, AlertTriangle, Clock, CheckCircle2, Calendar, RotateCcw, Box, FileText, User, Building, X } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/hooks/use-toast'
import archiveLendingService from '@/services/archive-lending.service'
import arsipService from '@/services/arsip.service'
import storageLocationService from '@/services/storage-location.service'
import { format, isPast, parseISO } from 'date-fns'
import { id as idLocale } from 'date-fns/locale'
import { TableSkeleton } from '@/components/LoadingSkeletons'

const STATUS_CONFIG = {
    borrowed: { label: 'Dipinjam', variant: 'default', icon: ArrowLeftRight, className: 'bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 hover:bg-blue-200 border-blue-200' },
    overdue: { label: 'Terlambat', variant: 'destructive', icon: AlertTriangle, className: '' },
    returned: { label: 'Dikembalikan', variant: 'secondary', icon: CheckCircle2, className: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 border-emerald-200' },
}

const EMPTY_BORROW_FORM = {
    lendingType: 'arsip',
    arsipId: '',
    storageLocationId: '',
    borrowerName: '',
    departmentUnit: '',
    dueDate: '',
    purpose: '',
}

// The list services differ: some already unwrap the { success, data } envelope, some do not.
const toList = (res) => (Array.isArray(res) ? res : res?.data ?? [])

const TYPE_CONFIG = {
    arsip: { label: 'Per Arsip', variant: 'outline', icon: FileText, className: 'border-indigo-200 text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/15' },
    box: { label: 'Per Box', variant: 'secondary', icon: Box, className: 'border-orange-200 text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-500/15' },
}

function StatusBadge({ status }) {
    const config = STATUS_CONFIG[status] || STATUS_CONFIG.borrowed
    const Icon = config.icon
    return (
        <Badge variant={config.variant} className={`flex items-center gap-1 w-fit ${config.className}`}>
            <Icon className="h-3 w-3" />
            {config.label}
        </Badge>
    )
}

function LendingRow({ item, onReturn, onExtend }) {
    const isOverdue = item.status === 'borrowed' && isPast(parseISO(item.dueDate))
    const typeConfig = TYPE_CONFIG[item.lendingType] || TYPE_CONFIG.arsip
    const TypeIcon = typeConfig.icon

    return (
        <TableRow className={`group hover:bg-muted/30 transition-colors ${isOverdue ? 'bg-red-50/50 hover:bg-red-50/80' : ''}`}>
            <TableCell>
                <div className="flex items-center gap-2">
                    <div className={`p-1.5 rounded-full ${item.lendingType === 'arsip' ? 'bg-indigo-100 dark:bg-indigo-500/15 text-indigo-600' : 'bg-orange-100 dark:bg-orange-500/15 text-orange-600'}`}>
                        <TypeIcon className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-sm font-medium">
                        {item.lendingType === 'arsip' ? 'Arsip' : 'Box'}
                    </span>
                </div>
            </TableCell>
            <TableCell className="font-medium">
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded border border-border">
                    {item.lendingType === 'arsip' ? item.arsip?.noArsip : item.storageLocation?.code}
                </code>
            </TableCell>
            <TableCell>
                <div className="flex items-center gap-2">
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm">{item.borrowerName}</span>
                </div>
            </TableCell>
            <TableCell>
                <div className="flex items-center gap-2">
                    <Building className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">{item.departmentUnit || '-'}</span>
                </div>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
                {format(parseISO(item.borrowDate), 'dd MMM yyyy', { locale: idLocale })}
            </TableCell>
            <TableCell>
                <div className={`flex flex-col ${isOverdue ? 'text-destructive font-semibold' : 'text-sm'}`}>
                    <span>{format(parseISO(item.dueDate), 'dd MMM yyyy', { locale: idLocale })}</span>
                    {isOverdue && <span className="text-[10px] flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Terlambat!</span>}
                </div>
            </TableCell>
            <TableCell>
                <StatusBadge status={isOverdue ? 'overdue' : item.status} />
            </TableCell>
            <TableCell className="text-right">
                <div className="flex justify-end gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                    {item.status === 'borrowed' && (
                        <>
                            <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => onExtend(item)}>
                                <Calendar className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">Perpanjang</span>
                            </Button>
                            <Button size="sm" className="h-8 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => onReturn(item)}>
                                <RotateCcw className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">Kembalikan</span>
                            </Button>
                        </>
                    )}
                    {item.status === 'returned' && item.returnDate && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            {format(parseISO(item.returnDate), 'dd MMM yyyy', { locale: idLocale })}
                        </span>
                    )}
                </div>
            </TableCell>
        </TableRow>
    )
}

export default function ArchiveLending() {
    const { session } = useAuth()
    const { toast } = useToast()
    const [activeTab, setActiveTab] = useState('active')
    const [data, setData] = useState([])
    const [stats, setStats] = useState(null)
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [returnDialogOpen, setReturnDialogOpen] = useState(false)
    const [extendDialogOpen, setExtendDialogOpen] = useState(false)
    const [borrowDialogOpen, setBorrowDialogOpen] = useState(false)
    const [selectedItem, setSelectedItem] = useState(null)
    const [returnNotes, setReturnNotes] = useState('')
    const [newDueDate, setNewDueDate] = useState('')
    const [borrowForm, setBorrowForm] = useState(EMPTY_BORROW_FORM)
    // Arsip / storage-location picker inside the borrow dialog
    const [targetQuery, setTargetQuery] = useState('')
    const [targetResults, setTargetResults] = useState([])
    const [targetLabel, setTargetLabel] = useState('')
    const [targetLoading, setTargetLoading] = useState(false)
    const targetSearchSeq = useRef(0)

    // Fetch data
    const fetchData = async () => {
        setLoading(true)
        try {
            const status = activeTab === 'active' ? 'borrowed' : activeTab === 'overdue' ? 'overdue' : 'returned'
            const response = await archiveLendingService.getAll({ status, limit: 50 })
            if (response.success) {
                setData(response.data)
            }
        } catch (error) {
            console.error('Gagal memuat data peminjaman:', error)
        } finally {
            setLoading(false)
        }
    }

    const fetchStats = async () => {
        try {
            const response = await archiveLendingService.getStats()
            if (response.success) {
                setStats(response.data)
            }
        } catch (error) {
            console.error('Error fetching stats:', error)
        }
    }

    useEffect(() => {
        fetchData()
    }, [activeTab])

    useEffect(() => {
        fetchStats()
    }, [])

    // Return handler
    const handleReturn = async () => {
        if (!selectedItem) return
        try {
            await archiveLendingService.return(selectedItem.id, returnNotes)
            toast({ title: 'Berhasil', description: 'Arsip berhasil dikembalikan' })
            setReturnDialogOpen(false)
            setReturnNotes('')
            fetchData()
            fetchStats()
        } catch (error) {
            toast({ title: 'Gagal mengembalikan arsip', description: error.message, variant: 'destructive' })
        }
    }

    // Extend handler
    const handleExtend = async () => {
        if (!selectedItem) return
        if (!newDueDate) {
            toast({ title: 'Data belum lengkap', description: 'Tanggal jatuh tempo baru wajib diisi', variant: 'destructive' })
            return
        }
        try {
            await archiveLendingService.extend(selectedItem.id, newDueDate)
            toast({ title: 'Berhasil', description: 'Tanggal jatuh tempo berhasil diperpanjang' })
            setExtendDialogOpen(false)
            setNewDueDate('')
            fetchData()
        } catch (error) {
            toast({ title: 'Gagal memperpanjang', description: error.message, variant: 'destructive' })
        }
    }

    const resetBorrowForm = () => {
        setBorrowForm(EMPTY_BORROW_FORM)
        setTargetQuery('')
        setTargetResults([])
        setTargetLabel('')
    }

    // Borrow handler
    const handleBorrow = async () => {
        const isArsip = borrowForm.lendingType === 'arsip'
        const targetId = isArsip ? borrowForm.arsipId : borrowForm.storageLocationId

        if (!targetId) {
            toast({
                title: 'Data belum lengkap',
                description: isArsip ? 'Pilih arsip dari hasil pencarian' : 'Pilih lokasi/box dari hasil pencarian',
                variant: 'destructive',
            })
            return
        }
        if (!borrowForm.borrowerName.trim()) {
            toast({ title: 'Data belum lengkap', description: 'Nama peminjam wajib diisi', variant: 'destructive' })
            return
        }
        if (!borrowForm.dueDate) {
            toast({ title: 'Data belum lengkap', description: 'Tanggal jatuh tempo wajib diisi', variant: 'destructive' })
            return
        }

        // The backend rejects an empty string for the unused id, so only the relevant one is sent.
        const payload = {
            lendingType: borrowForm.lendingType,
            borrowerName: borrowForm.borrowerName.trim(),
            departmentUnit: borrowForm.departmentUnit,
            dueDate: borrowForm.dueDate,
            purpose: borrowForm.purpose,
            ...(isArsip ? { arsipId: targetId } : { storageLocationId: targetId }),
        }

        try {
            await archiveLendingService.borrow(payload)
            toast({ title: 'Berhasil', description: 'Peminjaman berhasil dicatat' })
            setBorrowDialogOpen(false)
            resetBorrowForm()
            fetchData()
            fetchStats()
        } catch (error) {
            toast({ title: 'Gagal mencatat peminjaman', description: error.message, variant: 'destructive' })
        }
    }

    // Borrow target picker — the backend requires a UUID, so the id must come from a real record
    const searchTarget = async (query, lendingType) => {
        const seq = ++targetSearchSeq.current
        if (query.trim().length < 3) {
            setTargetResults([])
            setTargetLoading(false)
            return
        }
        setTargetLoading(true)
        try {
            const res = lendingType === 'arsip'
                ? await arsipService.search({ q: query, limit: 5 })
                : await storageLocationService.getAll({ search: query, limit: 5 })
            if (seq !== targetSearchSeq.current) return
            setTargetResults(toList(res))
        } catch (error) {
            if (seq !== targetSearchSeq.current) return
            setTargetResults([])
            toast({ title: 'Gagal mencari data', description: error.message, variant: 'destructive' })
        } finally {
            if (seq === targetSearchSeq.current) setTargetLoading(false)
        }
    }

    const handleTargetQueryChange = (value) => {
        setTargetQuery(value)
        searchTarget(value, borrowForm.lendingType)
    }

    const selectTarget = (item, label) => {
        setBorrowForm(f => f.lendingType === 'arsip'
            ? { ...f, arsipId: item.id, storageLocationId: '' }
            : { ...f, storageLocationId: item.id, arsipId: '' })
        setTargetLabel(label)
        setTargetResults([])
        setTargetQuery('')
    }

    const clearTarget = () => {
        setBorrowForm(f => ({ ...f, arsipId: '', storageLocationId: '' }))
        setTargetLabel('')
        setTargetQuery('')
        setTargetResults([])
    }

    const handleLendingTypeChange = (value) => {
        setBorrowForm(f => ({ ...f, lendingType: value, arsipId: '', storageLocationId: '' }))
        setTargetLabel('')
        setTargetQuery('')
        setTargetResults([])
    }

    const openReturnDialog = (item) => {
        setSelectedItem(item)
        setReturnDialogOpen(true)
    }

    const openExtendDialog = (item) => {
        setSelectedItem(item)
        setNewDueDate(item.dueDate)
        setExtendDialogOpen(true)
    }

    // Filter data
    const filteredData = data.filter(item => {
        if (!searchQuery) return true
        const query = searchQuery.toLowerCase()
        return (
            item.borrowerName?.toLowerCase().includes(query) ||
            item.arsip?.noArsip?.toLowerCase().includes(query) ||
            item.storageLocation?.code?.toLowerCase().includes(query)
        )
    })

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                    <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                        <div className="p-2 bg-indigo-100 dark:bg-indigo-500/15 rounded-lg">
                            <ArrowLeftRight className="h-6 w-6 text-indigo-600" />
                        </div>
                        Peminjaman Arsip
                    </h1>
                    <p className="text-muted-foreground">
                        Kelola sirkulasi peminjaman dan pengembalian arsip fisik
                    </p>
                </div>
                <Button onClick={() => setBorrowDialogOpen(true)} className="h-9 shadow-sm bg-indigo-600 hover:bg-indigo-700">
                    <Plus className="mr-2 h-4 w-4" />
                    Catat Peminjaman
                </Button>
            </div>

            {/* Stats */}
            {stats && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <Card className="shadow-sm border-l-4 border-l-blue-500 card-hover">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Sedang Dipinjam</CardTitle>
                            <div className="p-2 bg-blue-100 dark:bg-blue-500/15 rounded-full">
                                <ArrowLeftRight className="h-4 w-4 text-blue-600" />
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">{stats.borrowed}</div>
                            <p className="text-xs text-muted-foreground mt-1">Arsip aktif dipinjam</p>
                        </CardContent>
                    </Card>
                    <Card className="shadow-sm border-l-4 border-l-red-500 card-hover">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Terlambat</CardTitle>
                            <div className="p-2 bg-red-100 dark:bg-red-500/15 rounded-full">
                                <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-red-600 dark:text-red-400">{stats.overdue}</div>
                            <p className="text-xs text-muted-foreground mt-1">Melewati jatuh tempo</p>
                        </CardContent>
                    </Card>
                    <Card className="shadow-sm border-l-4 border-l-emerald-500 card-hover">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Dikembalikan</CardTitle>
                            <div className="p-2 bg-emerald-100 dark:bg-emerald-500/15 rounded-full">
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-emerald-600">{stats.returned}</div>
                            <p className="text-xs text-muted-foreground mt-1">Riwayat pengembalian</p>
                        </CardContent>
                    </Card>
                    <Card className="shadow-sm border-l-4 border-l-slate-500 card-hover">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Total Sirkulasi</CardTitle>
                            <div className="p-2 bg-muted rounded-full">
                                <Clock className="h-4 w-4 text-muted-foreground" />
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-foreground">{stats.total}</div>
                            <p className="text-xs text-muted-foreground mt-1">Total transaksi</p>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Main Content */}
            <Card className="shadow-sm border-border/60">
                <CardHeader className="pb-4 bg-muted/20">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full sm:w-auto">
                            <TabsList className="grid w-full grid-cols-3 sm:w-auto">
                                <TabsTrigger value="active" className="gap-2">
                                    <ArrowLeftRight className="h-4 w-4" />
                                    Dipinjam
                                </TabsTrigger>
                                <TabsTrigger value="overdue" className="gap-2 text-destructive data-[state=active]:text-destructive">
                                    <AlertTriangle className="h-4 w-4" />
                                    Terlambat
                                </TabsTrigger>
                                <TabsTrigger value="history" className="gap-2">
                                    <CheckCircle2 className="h-4 w-4" />
                                    Riwayat
                                </TabsTrigger>
                            </TabsList>
                        </Tabs>

                        <div className="relative w-full sm:w-72">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Cari peminjam, nomor arsip..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 bg-background"
                            />
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-muted/50">
                            <TableRow className="hover:bg-transparent">
                                <TableHead className="w-[120px]">Tipe</TableHead>
                                <TableHead className="w-[180px]">ID Arsip/Lokasi</TableHead>
                                <TableHead>Peminjam</TableHead>
                                <TableHead>Unit Kerja</TableHead>
                                <TableHead className="w-[150px]">Tgl Pinjam</TableHead>
                                <TableHead className="w-[150px]">Jatuh Tempo</TableHead>
                                <TableHead className="w-[140px]">Status</TableHead>
                                <TableHead className="w-[200px] text-right">Aksi</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={8} className="p-0">
                                        <TableSkeleton rows={5} columns={8} />
                                    </TableCell>
                                </TableRow>
                            ) : filteredData.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                                        <div className="flex flex-col items-center justify-center gap-2">
                                            <FileText className="h-8 w-8 opacity-20" />
                                            <p>{searchQuery ? 'Tidak ada hasil yang cocok' : 'Tidak ada data peminjaman'}</p>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : filteredData.map((item) => (
                                <LendingRow
                                    key={item.id}
                                    item={item}
                                    onReturn={openReturnDialog}
                                    onExtend={openExtendDialog}
                                />
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* Return Dialog */}
            <Dialog open={returnDialogOpen} onOpenChange={setReturnDialogOpen}>
                <DialogContent className="sm:max-w-[400px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <RotateCcw className="h-5 w-5 text-emerald-600" />
                            Kembalikan Arsip
                        </DialogTitle>
                        <DialogDescription>
                            Konfirmasi pengembalian arsip yang dipinjam oleh <span className="font-medium text-foreground">{selectedItem?.borrowerName}</span>
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="notes">Catatan Kondisi (opsional)</Label>
                            <Textarea
                                id="notes"
                                value={returnNotes}
                                onChange={(e) => setReturnNotes(e.target.value)}
                                placeholder="Contoh: Arsip kembali dalam kondisi baik"
                                rows={3}
                            />
                        </div>
                    </div>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button variant="outline" onClick={() => setReturnDialogOpen(false)}>Batal</Button>
                        <Button onClick={handleReturn} className="bg-emerald-600 hover:bg-emerald-700">Konfirmasi Pengembalian</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Extend Dialog */}
            <Dialog open={extendDialogOpen} onOpenChange={setExtendDialogOpen}>
                <DialogContent className="sm:max-w-[400px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Calendar className="h-5 w-5 text-blue-600" />
                            Perpanjang Peminjaman
                        </DialogTitle>
                        <DialogDescription>
                            Perpanjang jatuh tempo peminjaman oleh <span className="font-medium text-foreground">{selectedItem?.borrowerName}</span>
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="bg-muted px-4 py-3 rounded-md text-sm">
                            <div className="flex justify-between mb-1">
                                <span className="text-muted-foreground">Jatuh Tempo Saat Ini:</span>
                                <span className="font-medium">{selectedItem?.dueDate ? format(parseISO(selectedItem.dueDate), 'dd MMM yyyy', { locale: idLocale }) : '-'}</span>
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="newDueDate">Tanggal Jatuh Tempo Baru</Label>
                            <Input
                                id="newDueDate"
                                type="date"
                                value={newDueDate}
                                onChange={(e) => setNewDueDate(e.target.value)}
                            />
                        </div>
                    </div>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button variant="outline" onClick={() => setExtendDialogOpen(false)}>Batal</Button>
                        <Button onClick={handleExtend} className="bg-primary hover:bg-primary">Perpanjang</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Borrow Dialog */}
            <Dialog open={borrowDialogOpen} onOpenChange={setBorrowDialogOpen}>
                <DialogContent className="sm:max-w-[550px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Plus className="h-5 w-5 text-indigo-600" />
                            Catat Peminjaman Baru
                        </DialogTitle>
                        <DialogDescription>
                            Isi formulir untuk mencatat peminjaman arsip fisik atau box arsip
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label className="text-right">Tipe</Label>
                            <Select
                                value={borrowForm.lendingType}
                                onValueChange={handleLendingTypeChange}
                            >
                                <SelectTrigger className="col-span-3">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="arsip">
                                        <div className="flex items-center gap-2">
                                            <FileText className="h-4 w-4" /> Per Arsip
                                        </div>
                                    </SelectItem>
                                    <SelectItem value="box">
                                        <div className="flex items-center gap-2">
                                            <Box className="h-4 w-4" /> Per Box
                                        </div>
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid grid-cols-4 items-start gap-4">
                            <Label className="text-right pt-2">{borrowForm.lendingType === 'arsip' ? 'Arsip' : 'Lokasi / Box'}</Label>
                            <div className="col-span-3 space-y-2">
                                {targetLabel ? (
                                    <div className="flex items-center gap-2 text-sm bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-100 rounded-md px-3 py-2">
                                        {borrowForm.lendingType === 'arsip' ? <FileText className="h-4 w-4 shrink-0" /> : <Box className="h-4 w-4 shrink-0" />}
                                        <span className="truncate">{targetLabel}</span>
                                        <Button variant="ghost" size="sm" className="h-auto p-0 ml-auto text-muted-foreground hover:text-destructive" onClick={clearTarget}>
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ) : (
                                    <>
                                        <div className="relative">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                            <Input
                                                value={targetQuery}
                                                onChange={(e) => handleTargetQueryChange(e.target.value)}
                                                className="pl-9"
                                                placeholder={borrowForm.lendingType === 'arsip'
                                                    ? 'Cari nomor berkas atau uraian arsip (min. 3 huruf)'
                                                    : 'Cari kode atau nama lokasi (min. 3 huruf)'}
                                            />
                                        </div>
                                        {targetLoading && (
                                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                Sedang mencari...
                                            </div>
                                        )}
                                        {!targetLoading && targetResults.length > 0 && (
                                            <div className="border rounded-md max-h-40 overflow-y-auto bg-background shadow-sm">
                                                {targetResults.map((item) => {
                                                    const title = borrowForm.lendingType === 'arsip'
                                                        ? (item.nomorBerkas || 'Tanpa Nomor')
                                                        : item.code
                                                    const subtitle = borrowForm.lendingType === 'arsip'
                                                        ? (item.uraianBerkas || '-')
                                                        : `${item.name || '-'}${item.level ? ` · ${item.level}` : ''}`
                                                    return (
                                                        <div
                                                            key={item.id}
                                                            className="p-3 text-sm cursor-pointer border-b last:border-0 hover:bg-muted/50"
                                                            onClick={() => selectTarget(item, `${title} — ${subtitle}`)}
                                                        >
                                                            <div className="font-medium">{title}</div>
                                                            <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        )}
                                        {!targetLoading && targetQuery.trim().length >= 3 && targetResults.length === 0 && (
                                            <p className="text-xs text-muted-foreground">Tidak ada hasil yang cocok</p>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label className="text-right">Peminjam</Label>
                            <div className="col-span-3 relative">
                                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    value={borrowForm.borrowerName}
                                    onChange={(e) => setBorrowForm({ ...borrowForm, borrowerName: e.target.value })}
                                    className="pl-9"
                                    placeholder="Nama lengkap peminjam"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label className="text-right">Unit Kerja</Label>
                            <div className="col-span-3 relative">
                                <Building className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    value={borrowForm.departmentUnit}
                                    onChange={(e) => setBorrowForm({ ...borrowForm, departmentUnit: e.target.value })}
                                    className="pl-9"
                                    placeholder="Divisi / Unit asal peminjam"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label className="text-right">Jatuh Tempo</Label>
                            <Input
                                type="date"
                                value={borrowForm.dueDate}
                                onChange={(e) => setBorrowForm({ ...borrowForm, dueDate: e.target.value })}
                                className="col-span-3"
                            />
                        </div>

                        <div className="grid grid-cols-4 items-start gap-4">
                            <Label className="text-right pt-2">Tujuan</Label>
                            <Textarea
                                value={borrowForm.purpose}
                                onChange={(e) => setBorrowForm({ ...borrowForm, purpose: e.target.value })}
                                className="col-span-3"
                                placeholder="Untuk keperluan apa arsip dipinjam?"
                                rows={2}
                            />
                        </div>
                    </div>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button variant="outline" onClick={() => setBorrowDialogOpen(false)}>Batal</Button>
                        <Button onClick={handleBorrow} className="bg-indigo-600 hover:bg-indigo-700">Simpan Peminjaman</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
