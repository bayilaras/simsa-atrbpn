import { useCallback, useState, useEffect } from 'react'
import { useAuth } from '@/context/AuthContext'
import { Inbox, Send, Check, X, Clock, ArrowRight, RefreshCw, Eye, CheckCircle, XCircle, Search, Filter, Mail, ArrowUpRight, ArrowDownLeft } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import distributionService from '@/services/distribution.service'
import { format } from 'date-fns'
import { id as localeId } from 'date-fns/locale'
import { TableSkeleton } from '@/components/LoadingSkeletons'
import { useRequiredUnitKerjaScope } from '@/hooks/use-required-unit-kerja-scope'
import { RequiredUnitKerjaScope } from '@/components/RequiredUnitKerjaScope'

const statusConfig = {
    sent: { label: 'Menunggu', variant: 'outline', icon: Clock, className: 'text-yellow-600 dark:text-yellow-400 border-yellow-200 bg-yellow-50 dark:bg-yellow-500/15' },
    received: { label: 'Diterima', variant: 'secondary', icon: Check, className: 'text-blue-600 border-blue-200 bg-blue-50 dark:bg-blue-500/15' },
    processed: { label: 'Selesai', variant: 'default', icon: CheckCircle, className: 'bg-emerald-600 hover:bg-emerald-700' },
    rejected: { label: 'Ditolak', variant: 'destructive', icon: XCircle, className: '' },
}

export default function DistributionInbox() {
    const { toast } = useToast()
    const { user } = useAuth()
    const [activeTab, setActiveTab] = useState('inbox')
    const [inboxData, setInboxData] = useState([])
    const [outboxData, setOutboxData] = useState([])
    const [stats, setStats] = useState(null)
    const [loading, setLoading] = useState(true)
    const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
    const [selectedDistribution, setSelectedDistribution] = useState(null)
    const [rejectReason, setRejectReason] = useState('')
    const [searchTerm, setSearchTerm] = useState('')
    const [actionLoading, setActionLoading] = useState(false)

    const unitScope = useRequiredUnitKerjaScope(user)
    const unitKerjaId = unitScope.unitKerjaId

    const loadData = useCallback(async () => {
        if (!unitKerjaId) {
            setInboxData([])
            setOutboxData([])
            setStats(null)
            setLoading(false)
            return
        }
        setLoading(true)
        try {
            const [inboxRes, outboxRes, statsRes] = await Promise.all([
                distributionService.getInbox(unitKerjaId),
                distributionService.getOutbox(unitKerjaId),
                distributionService.getStats(unitKerjaId),
            ])

            setInboxData(inboxRes)
            setOutboxData(outboxRes)
            setStats(statsRes)
        } catch (error) {
            console.error('Error loading distribution data:', error)
            toast({
                title: 'Error',
                description: 'Gagal memuat data distribusi',
                variant: 'destructive',
            })
        } finally {
            setLoading(false)
        }
    }, [toast, unitKerjaId])

    useEffect(() => {
        loadData()
    }, [loadData])

    const handleReceive = async (distributionId) => {
        setActionLoading(true)
        try {
            await distributionService.receive(distributionId, unitKerjaId)
            toast({ title: 'Berhasil', description: 'Surat berhasil diterima' })
            loadData()
        } catch (error) {
            toast({
                title: 'Error',
                description: error.response?.data?.error || 'Gagal menerima surat',
                variant: 'destructive',
            })
        } finally {
            setActionLoading(false)
        }
    }

    const handleProcess = async (distributionId) => {
        setActionLoading(true)
        try {
            await distributionService.process(distributionId, unitKerjaId)
            toast({ title: 'Berhasil', description: 'Surat ditandai selesai diproses' })
            loadData()
        } catch (error) {
            toast({
                title: 'Error',
                description: error.response?.data?.error || 'Gagal memproses surat',
                variant: 'destructive',
            })
        } finally {
            setActionLoading(false)
        }
    }

    const handleReject = async () => {
        if (!rejectReason.trim()) {
            toast({
                title: 'Validasi',
                description: 'Alasan penolakan wajib diisi',
                variant: 'destructive',
            })
            return
        }

        setActionLoading(true)
        try {
            await distributionService.reject(selectedDistribution.id, rejectReason, unitKerjaId)
            toast({ title: 'Berhasil', description: 'Surat dikembalikan ke pengirim' })
            setRejectDialogOpen(false)
            setRejectReason('')
            setSelectedDistribution(null)
            loadData()
        } catch (error) {
            toast({
                title: 'Error',
                description: error.response?.data?.error || 'Gagal menolak surat',
                variant: 'destructive',
            })
        } finally {
            setActionLoading(false)
        }
    }

    const openRejectDialog = (distribution) => {
        setSelectedDistribution(distribution)
        setRejectDialogOpen(true)
    }

    const formatDate = (dateString) => {
        if (!dateString) return '-'
        return format(new Date(dateString), 'dd MMM yyyy, HH:mm', { locale: localeId })
    }

    const renderStatusBadge = (status) => {
        const config = statusConfig[status] || statusConfig.sent
        const Icon = config.icon
        return (
            <Badge variant={config.variant} className={`gap-1 ${config.className}`}>
                <Icon className="h-3 w-3" />
                {config.label}
            </Badge>
        )
    }

    const filteredInbox = inboxData.filter(item =>
        item.surat?.perihal?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.surat?.nomorSurat?.toLowerCase().includes(searchTerm.toLowerCase())
    )

    const filteredOutbox = outboxData.filter(item =>
        item.surat?.perihal?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.surat?.nomorSurat?.toLowerCase().includes(searchTerm.toLowerCase())
    )

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                    <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                        <div className="p-2 bg-indigo-100 dark:bg-indigo-500/15 rounded-lg">
                            <Inbox className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        Distribusi Surat
                    </h1>
                    <p className="text-muted-foreground">Kelola aliran surat masuk dan keluar antar unit kerja</p>
                </div>
                <Button variant="outline" onClick={loadData} disabled={loading || actionLoading} className="h-9">
                    <RefreshCw className={`h-3.5 w-3.5 mr-2 ${loading ? 'animate-spin' : ''}`} />
                    Refresh Data
                </Button>
            </div>

            <RequiredUnitKerjaScope scope={unitScope} disabled={loading || actionLoading} />

            {/* Stats Cards */}
            {stats && (
                <div className="grid gap-4 lg:grid-cols-4">
                    <Card className="shadow-sm border-l-4 border-l-blue-500 card-hover">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Surat Masuk</CardTitle>
                            <div className="p-2 bg-blue-100 dark:bg-blue-500/15 rounded-full">
                                <ArrowDownLeft className="h-4 w-4 text-blue-600" />
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">{stats.inbox?.total || 0}</div>
                            <p className="text-xs text-muted-foreground mt-1">
                                <span className="font-medium text-orange-600 dark:text-orange-400">{stats.inbox?.pending || 0}</span> menunggu diterima
                            </p>
                        </CardContent>
                    </Card>
                    <Card className="shadow-sm border-l-4 border-l-orange-500 card-hover">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Perlu Proses</CardTitle>
                            <div className="p-2 bg-orange-100 dark:bg-orange-500/15 rounded-full">
                                <Clock className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                                {(stats.inbox?.pending || 0) + (stats.inbox?.received || 0)}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">Belum tuntas</p>
                        </CardContent>
                    </Card>
                    <Card className="shadow-sm border-l-4 border-l-emerald-500 card-hover">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Selesai</CardTitle>
                            <div className="p-2 bg-emerald-100 dark:bg-emerald-500/15 rounded-full">
                                <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{stats.inbox?.processed || 0}</div>
                            <p className="text-xs text-muted-foreground mt-1">Telah diproses</p>
                        </CardContent>
                    </Card>
                    <Card className="shadow-sm border-l-4 border-l-indigo-500 card-hover">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Surat Dikirim</CardTitle>
                            <div className="p-2 bg-indigo-100 dark:bg-indigo-500/15 rounded-full">
                                <Send className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{stats.outbox?.total || 0}</div>
                            <p className="text-xs text-muted-foreground mt-1">
                                <span className="font-medium text-orange-600 dark:text-orange-400">{stats.outbox?.pending || 0}</span> belum diterima
                            </p>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Tabs & Content */}
            <Tabs value={activeTab} onValueChange={(val) => { setActiveTab(val); setSearchTerm('') }} className="space-y-4">
                <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between gap-4">
                    <TabsList className="bg-muted/50 p-1">
                        <TabsTrigger value="inbox" className="gap-2">
                            <Inbox className="h-4 w-4" />
                            Kotak Masuk
                            {stats?.inbox?.pending > 0 && (
                                <Badge variant="destructive" className="ml-1 h-5 w-5 p-0 justify-center text-[10px]">
                                    {stats.inbox.pending}
                                </Badge>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="outbox" className="gap-2">
                            <Send className="h-4 w-4" />
                            Kotak Keluar
                        </TabsTrigger>
                    </TabsList>

                    <div className="relative w-full sm:w-[300px]">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            placeholder={`Cari surat di ${activeTab === 'inbox' ? 'kotak masuk' : 'kotak keluar'}...`}
                            className="pl-9 bg-background/50 focus:bg-background transition-colors"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>

                {/* Inbox Content */}
                <TabsContent value="inbox" className="space-y-4 mt-0 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <Card className="shadow-sm border-border/60">
                        <CardHeader className="pb-3 bg-muted/20">
                            <CardTitle className="text-base flex items-center gap-2">
                                <ArrowDownLeft className="h-4 w-4 text-blue-500" />
                                Surat Distribusi Masuk
                            </CardTitle>
                            <CardDescription>Daftar surat yang didistribusikan ke unit kerja Anda</CardDescription>
                        </CardHeader>
                        <CardContent className="p-0">
                            <Table responsive>
                                <TableHeader className="bg-muted/50">
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead className="w-[50px] text-center">No.</TableHead>
                                        <TableHead className="w-[180px]">Nomor Surat</TableHead>
                                        <TableHead className="min-w-[200px]">Perihal</TableHead>
                                        <TableHead className="w-[180px]">Dari Unit</TableHead>
                                        <TableHead className="w-[180px]">Instruksi</TableHead>
                                        <TableHead className="w-[150px]">Tanggal Kirim</TableHead>
                                        <TableHead className="w-[120px]">Status</TableHead>
                                        <TableHead className="w-[140px] text-right">Aksi</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        <TableRow>
                                            <TableCell colSpan={8} className="p-0">
                                                <TableSkeleton rows={5} columns={8} />
                                            </TableCell>
                                        </TableRow>
                                    ) : filteredInbox.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                                                <div className="flex flex-col items-center justify-center gap-2">
                                                    <Mail className="h-8 w-8 opacity-20" />
                                                    <p>{searchTerm ? 'Tidak ada surat yang cocok dengan pencarian' : 'Tidak ada surat distribusi yang masuk'}</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : filteredInbox.map((item, index) => (
                                        <TableRow key={item.id} className="group hover:bg-muted/30 transition-colors">
                                            <TableCell data-label="No." className="text-center font-medium text-xs text-muted-foreground">{index + 1}</TableCell>
                                            <TableCell data-label="Nomor Surat">
                                                <code className="text-xs bg-muted px-1.5 py-0.5 rounded border border-border">
                                                    {item.surat?.nomorSurat || '-'}
                                                </code>
                                            </TableCell>
                                            <TableCell data-label="Perihal">
                                                <span className="font-medium text-sm line-clamp-2 group-hover:text-primary transition-colors">
                                                    {item.surat?.perihal || '-'}
                                                </span>
                                            </TableCell>
                                            <TableCell data-label="Dari Unit" className="text-sm text-muted-foreground">
                                                {item.sourceUnit?.name || '-'}
                                            </TableCell>
                                            <TableCell data-label="Instruksi" className="text-sm font-medium text-orange-600 dark:text-orange-400/90 italic">
                                                "{item.instruction || '-'}"
                                            </TableCell>
                                            <TableCell data-label="Tanggal Kirim" className="text-xs text-muted-foreground whitespace-nowrap">
                                                {formatDate(item.sentAt)}
                                            </TableCell>
                                            <TableCell data-label="Status">{renderStatusBadge(item.status)}</TableCell>
                                            <TableCell data-label="Aksi" className="text-right">
                                                <div className="flex items-center justify-end gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                                                    {item.status === 'sent' && (
                                                        <TooltipProvider>
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <Button
                                                                        variant="outline"
                                                                        size="icon"
                                                                        className="h-8 w-8 hover:bg-green-50 dark:hover:bg-green-500/15 hover:text-green-600 dark:hover:text-green-400 hover:border-green-200 transition-colors"
                                                                        onClick={() => handleReceive(item.id)}
                                                                        disabled={actionLoading}
                                                                    >
                                                                        <Check className="h-4 w-4" />
                                                                    </Button>
                                                                </TooltipTrigger>
                                                                <TooltipContent>Terima Surat</TooltipContent>
                                                            </Tooltip>
                                                        </TooltipProvider>
                                                    )}
                                                    {item.status === 'received' && (
                                                        <TooltipProvider>
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <Button
                                                                        variant="default"
                                                                        size="icon"
                                                                        className="h-8 w-8 bg-emerald-600 hover:bg-emerald-700 shadow-sm"
                                                                        onClick={() => handleProcess(item.id)}
                                                                        disabled={actionLoading}
                                                                    >
                                                                        <CheckCircle className="h-4 w-4" />
                                                                    </Button>
                                                                </TooltipTrigger>
                                                                <TooltipContent>Tandai Selesai Diproses</TooltipContent>
                                                            </Tooltip>
                                                        </TooltipProvider>
                                                    )}
                                                    {(item.status === 'sent' || item.status === 'received') && (
                                                        <TooltipProvider>
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                                                        onClick={() => openRejectDialog(item)}
                                                                        disabled={actionLoading}
                                                                    >
                                                                        <XCircle className="h-4 w-4" />
                                                                    </Button>
                                                                </TooltipTrigger>
                                                                <TooltipContent>Tolak & Kembalikan</TooltipContent>
                                                            </Tooltip>
                                                        </TooltipProvider>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Outbox Content */}
                <TabsContent value="outbox" className="space-y-4 mt-0 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <Card className="shadow-sm border-border/60">
                        <CardHeader className="pb-3 bg-muted/20">
                            <CardTitle className="text-base flex items-center gap-2">
                                <ArrowUpRight className="h-4 w-4 text-indigo-500" />
                                Surat Distribusi Keluar
                            </CardTitle>
                            <CardDescription>Daftar surat yang Anda distribusikan ke unit lain</CardDescription>
                        </CardHeader>
                        <CardContent className="p-0">
                            <Table responsive>
                                <TableHeader className="bg-muted/50">
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead className="w-[50px] text-center">No.</TableHead>
                                        <TableHead className="w-[180px]">Nomor Surat</TableHead>
                                        <TableHead className="min-w-[200px]">Perihal</TableHead>
                                        <TableHead className="w-[180px]">Tujuan Unit</TableHead>
                                        <TableHead className="w-[180px]">Instruksi</TableHead>
                                        <TableHead className="w-[150px]">Tanggal Kirim</TableHead>
                                        <TableHead className="w-[120px]">Status</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        <TableRow>
                                            <TableCell colSpan={7} className="p-0">
                                                <TableSkeleton rows={5} columns={7} />
                                            </TableCell>
                                        </TableRow>
                                    ) : filteredOutbox.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                                                <div className="flex flex-col items-center justify-center gap-2">
                                                    <Send className="h-8 w-8 opacity-20" />
                                                    <p>{searchTerm ? 'Tidak ada surat yang cocok dengan pencarian' : 'Tidak ada surat yang didistribusikan'}</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : filteredOutbox.map((item, index) => (
                                        <TableRow key={item.id} className="group hover:bg-muted/30 transition-colors">
                                            <TableCell data-label="No." className="text-center font-medium text-xs text-muted-foreground">{index + 1}</TableCell>
                                            <TableCell data-label="Nomor Surat">
                                                <code className="text-xs bg-muted px-1.5 py-0.5 rounded border border-border">
                                                    {item.surat?.nomorSurat || '-'}
                                                </code>
                                            </TableCell>
                                            <TableCell data-label="Perihal">
                                                <span className="font-medium text-sm line-clamp-2 group-hover:text-primary transition-colors">
                                                    {item.surat?.perihal || '-'}
                                                </span>
                                            </TableCell>
                                            <TableCell data-label="Tujuan Unit" className="text-sm text-muted-foreground">
                                                {item.targetUnit?.name || '-'}
                                            </TableCell>
                                            <TableCell data-label="Instruksi" className="text-sm font-medium text-orange-600 dark:text-orange-400/90 italic">
                                                "{item.instruction || '-'}"
                                            </TableCell>
                                            <TableCell data-label="Tanggal Kirim" className="text-xs text-muted-foreground whitespace-nowrap">
                                                {formatDate(item.sentAt)}
                                            </TableCell>
                                            <TableCell data-label="Status">{renderStatusBadge(item.status)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {/* Reject Dialog */}
            <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-destructive">
                            <XCircle className="h-5 w-5" />
                            Tolak Distribusi
                        </DialogTitle>
                        <DialogDescription>
                            Surat akan dikembalikan ke pengirim. Harap berikan alasan penolakan yang jelas.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4 space-y-4">
                        <div className="bg-muted/30 p-3 rounded-md text-sm border border-border/50">
                            <span className="font-semibold text-foreground">Surat:</span> {selectedDistribution?.surat?.perihal}
                        </div>
                        <Textarea
                            placeholder="Tuliskan alasan penolakan di sini..."
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            rows={4}
                            className="bg-background focus:bg-background"
                        />
                    </div>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>
                            Batal
                        </Button>
                        <Button variant="destructive" onClick={handleReject} disabled={actionLoading}>
                            {actionLoading ? 'Mengirim...' : 'Tolak & Kembalikan'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
