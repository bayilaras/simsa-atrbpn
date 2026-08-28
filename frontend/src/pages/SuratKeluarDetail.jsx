import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
    ArrowLeft, Send, Calendar, Building, FileText,
    Download, ExternalLink, Edit, Archive, MailOpen, Clock,
    CheckCircle, AlertCircle, Loader2, Eye, MoreHorizontal,
    Link2, Sparkles
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/hooks/use-toast'
import { ArchiveDialog } from '@/components/ArchiveDialog'
import suratKeluarService from '@/services/surat-keluar.service'
import approvalService from '@/services/approval.service'
import { API_BASE_URL } from '@/services/api'
import { format, formatDistanceToNow } from 'date-fns'
import { id as localeId } from 'date-fns/locale'
import { useAuth } from '@/context/AuthContext'

export default function SuratKeluarDetail() {
    const { id } = useParams()
    const navigate = useNavigate()
    const { toast } = useToast()
    const { canWrite, user } = useAuth()
    const isAdmin = canWrite()

    const [surat, setSurat] = useState(null)
    const [loading, setLoading] = useState(true)
    const [archiveDialogOpen, setArchiveDialogOpen] = useState(false)
    const [approvalHistory, setApprovalHistory] = useState([])
    const [approvers, setApprovers] = useState([])
    const [approvalAction, setApprovalAction] = useState(null)
    const [approvalNotes, setApprovalNotes] = useState('')
    const [selectedApproverId, setSelectedApproverId] = useState('')
    const [approvalBusy, setApprovalBusy] = useState(false)

    const fetchSurat = useCallback(async () => {
        setLoading(true)
        try {
            const data = await suratKeluarService.getById(id)
            setSurat(data)
        } catch (error) {
            console.error('Error fetching surat:', error)
            toast({
                title: 'Error',
                description: 'Gagal memuat data surat',
                variant: 'destructive',
            })
        } finally {
            setLoading(false)
        }
    }, [id, toast])

    useEffect(() => {
        fetchSurat()
    }, [fetchSurat])

    useEffect(() => {
        let cancelled = false
        if (!isAdmin || !surat?.id) {
            setApprovalHistory([])
            setApprovers([])
            return () => { cancelled = true }
        }

        const loadApproval = async () => {
            const historyPromise = approvalService.getHistory(surat.id)
            const approverPromise = (
                ['draft', 'rejected'].includes(surat.approvalStatus)
                && surat.createdBy === user?.id
            )
                ? approvalService.getEligibleApprovers(surat.id)
                : Promise.resolve([])
            const [historyResult, approverResult] = await Promise.allSettled([
                historyPromise,
                approverPromise,
            ])
            if (cancelled) return
            setApprovalHistory(historyResult.status === 'fulfilled' ? historyResult.value : [])
            setApprovers(approverResult.status === 'fulfilled' ? approverResult.value : [])
        }

        loadApproval()
        return () => { cancelled = true }
    }, [isAdmin, surat?.id, surat?.approvalStatus, surat?.createdBy, user?.id])

    const formatDate = (dateString) => {
        if (!dateString) return '-'
        try {
            return format(new Date(dateString), 'dd MMMM yyyy', { locale: localeId })
        } catch {
            return dateString
        }
    }

    const formatRelativeTime = (dateString) => {
        if (!dateString) return ''
        try {
            return formatDistanceToNow(new Date(dateString), { addSuffix: true, locale: localeId })
        } catch {
            return ''
        }
    }

    const getFileExtension = (filename) => {
        if (!filename) return ''
        return filename.split('.').pop()?.toLowerCase() || ''
    }

    const isPdf = (filename) => {
        return getFileExtension(filename) === 'pdf'
    }

    const isImage = (filename) => {
        const ext = getFileExtension(filename)
        return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)
    }

    const handleArchive = async (metadata) => {
        try {
            await suratKeluarService.archive(surat.id, metadata)
            toast({
                title: 'Berhasil Diarsipkan',
                description: `Surat ${surat.nomorSurat} telah diarsipkan`,
            })
            fetchSurat()
        } catch (error) {
            toast({
                title: 'Error',
                description: error.message || 'Gagal mengarsipkan surat',
                variant: 'destructive',
            })
        }
    }

    const openApprovalDialog = (action) => {
        setApprovalAction(action)
        setApprovalNotes('')
        setSelectedApproverId('')
    }

    const handleApprovalAction = async () => {
        if (!approvalAction || !surat) return
        if (approvalAction === 'submit' && !selectedApproverId) {
            toast({
                title: 'Penyetuju wajib dipilih',
                description: 'Pilih administrator aktif yang akan menelaah surat.',
                variant: 'destructive',
            })
            return
        }
        if (approvalAction === 'reject' && !approvalNotes.trim()) {
            toast({
                title: 'Alasan wajib diisi',
                description: 'Tuliskan alasan penolakan agar pembuat dapat memperbaiki surat.',
                variant: 'destructive',
            })
            return
        }

        setApprovalBusy(true)
        try {
            if (approvalAction === 'submit') {
                await approvalService.submit(surat.id, selectedApproverId, approvalNotes)
            } else if (approvalAction === 'approve') {
                await approvalService.approve(surat.id, approvalNotes)
            } else {
                await approvalService.reject(surat.id, approvalNotes)
            }
            toast({
                title: 'Alur persetujuan diperbarui',
                description: approvalAction === 'submit'
                    ? 'Surat telah dikirim ke penyetuju.'
                    : approvalAction === 'approve'
                        ? 'Surat telah memperoleh persetujuan final.'
                        : 'Surat dikembalikan kepada pembuat untuk diperbaiki.',
            })
            setApprovalAction(null)
            await fetchSurat()
        } catch (error) {
            toast({
                title: 'Gagal memperbarui persetujuan',
                description: error.message,
                variant: 'destructive',
            })
        } finally {
            setApprovalBusy(false)
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="flex flex-col items-center gap-4">
                    <div className="relative">
                        <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full blur-xl opacity-30 animate-pulse" />
                        <Loader2 className="h-12 w-12 animate-spin text-blue-600 relative" />
                    </div>
                    <p className="text-muted-foreground font-medium">Memuat data surat...</p>
                </div>
            </div>
        )
    }

    if (!surat) {
        return (
            <div className="space-y-6">
                <Button variant="ghost" onClick={() => navigate(-1)}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Kembali
                </Button>
                <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-16">
                        <div className="bg-muted/50 p-4 rounded-full mb-4">
                            <AlertCircle className="h-12 w-12 text-muted-foreground" />
                        </div>
                        <h2 className="text-xl font-semibold mb-2">Surat Tidak Ditemukan</h2>
                        <p className="text-muted-foreground text-center max-w-sm">
                            Data surat dengan ID tersebut tidak tersedia atau mungkin sudah dihapus.
                        </p>
                        <Button className="mt-6" onClick={() => navigate('/surat/keluar')}>
                            Kembali ke Daftar Surat
                        </Button>
                    </CardContent>
                </Card>
            </div>
        )
    }

    const fileUrl = surat.filePath
        ? `${API_BASE_URL}/api/files/surat_keluar/${encodeURIComponent(surat.id)}`
        : null
    const downloadUrl = fileUrl ? `${fileUrl}?download=1` : null
    const fileName = surat.fileOriginalName || surat.filePath?.split('/').pop()
    const approvalStatus = surat.approvalStatus || 'draft'
    const approvalStatusLabel = {
        draft: 'Draft',
        pending: 'Menunggu Persetujuan',
        approved: 'Disetujui',
        rejected: 'Ditolak / Perlu Perbaikan',
    }[approvalStatus] || approvalStatus
    const canEdit = isAdmin && !surat.isArchived && ['draft', 'rejected'].includes(approvalStatus)
    const canArchive = isAdmin && !surat.isArchived && approvalStatus === 'approved'
    const canSubmitApproval = canEdit && surat.createdBy === user?.id
    const isCurrentApprover = isAdmin
        && approvalStatus === 'pending'
        && surat.currentApproverId === user?.id

    return (
        <div className="space-y-6">
            {/* Breadcrumb */}
            <nav className="flex items-center gap-2 text-sm text-muted-foreground">
                <Link to="/surat" className="hover:text-foreground transition-colors">Surat</Link>
                <span>/</span>
                <Link to="/surat/keluar" className="hover:text-foreground transition-colors">Keluar</Link>
                <span>/</span>
                <span className="text-foreground font-medium truncate max-w-[200px]">{surat.nomorSurat}</span>
            </nav>

            {/* Hero Header with Gradient */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 p-6 md:p-8 text-white shadow-xl">
                {/* Background Pattern */}
                <div className="absolute inset-0 opacity-10">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-card rounded-full blur-3xl transform translate-x-1/2 -translate-y-1/2" />
                    <div className="absolute bottom-0 left-0 w-48 h-48 bg-card rounded-full blur-3xl transform -translate-x-1/2 translate-y-1/2" />
                </div>

                <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div className="flex items-start gap-4">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="text-white/80 hover:text-white hover:bg-card/10 shrink-0"
                            onClick={() => navigate(-1)}
                        >
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                        <div className="flex items-center gap-4">
                            <div className="bg-card/20 p-3 rounded-xl backdrop-blur-sm shrink-0 hidden sm:flex">
                                <Send className="h-8 w-8" />
                            </div>
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <h1 className="text-xl md:text-2xl font-bold">Detail Surat Keluar</h1>
                                    <Badge className="border-0 bg-card/20 text-white hover:bg-card/20">
                                        {approvalStatusLabel}
                                    </Badge>
                                </div>
                                <p className="font-mono text-white/90 text-sm md:text-base truncate">{surat.nomorSurat}</p>
                            </div>
                        </div>
                    </div>

                    {/* Desktop Actions */}
                    {isAdmin && (
                        <div className="hidden md:flex gap-2">
                            {canEdit && (
                                <Button
                                    variant="secondary"
                                    className="bg-card/20 hover:bg-card/30 text-white border-0 backdrop-blur-sm"
                                    onClick={() => navigate(`/surat/keluar/edit/${surat.id}`)}
                                >
                                    <Edit className="mr-2 h-4 w-4" />
                                    Edit
                                </Button>
                            )}
                            {canArchive && (
                                <Button
                                    className="bg-card text-blue-700 hover:bg-card/90"
                                    onClick={() => setArchiveDialogOpen(true)}
                                >
                                    <Archive className="mr-2 h-4 w-4" />
                                    Arsipkan
                                </Button>
                            )}
                        </div>
                    )}

                    {/* Mobile Actions */}
                    {isAdmin && (canEdit || canArchive) && (
                        <div className="md:hidden flex gap-2">
                            {canEdit && (
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    className="bg-card/20 hover:bg-card/30 text-white border-0 flex-1"
                                    onClick={() => navigate(`/surat/keluar/edit/${surat.id}`)}
                                >
                                    <Edit className="mr-2 h-4 w-4" />
                                    Edit
                                </Button>
                            )}
                            {canArchive && (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            variant="secondary"
                                            size="icon"
                                            className="bg-card/20 hover:bg-card/30 text-white border-0"
                                        >
                                            <MoreHorizontal className="h-4 w-4" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuItem onClick={() => setArchiveDialogOpen(true)}>
                                            <Archive className="mr-2 h-4 w-4" />
                                            Arsipkan
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Main Content */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Surat Info Card */}
                    <Card className="shadow-sm hover:shadow-md transition-shadow duration-200">
                        <CardHeader className="pb-4">
                            <CardTitle className="flex items-center gap-2">
                                <FileText className="h-5 w-5 text-blue-600" />
                                Informasi Surat
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            {/* Perihal Highlight Section */}
                            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 p-4 rounded-xl border border-blue-100 dark:border-blue-900/50">
                                <label className="text-xs uppercase tracking-wider font-semibold text-blue-700 dark:text-blue-400 flex items-center gap-1">
                                    <Sparkles className="h-3 w-3" />
                                    Perihal
                                </label>
                                <p className="text-lg font-semibold text-foreground dark:text-white mt-1 leading-relaxed">
                                    {surat.perihal}
                                </p>
                            </div>

                            {/* Details Grid */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-1 p-3 bg-muted/30 rounded-lg">
                                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Nomor Surat</label>
                                    <p className="font-mono text-sm bg-background px-3 py-2 rounded-md border">{surat.nomorSurat}</p>
                                </div>
                                <div className="space-y-1 p-3 bg-muted/30 rounded-lg">
                                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tanggal Surat</label>
                                    <p className="flex items-center gap-2 text-sm">
                                        <Calendar className="h-4 w-4 text-blue-600" />
                                        {formatDate(surat.tanggalSurat)}
                                    </p>
                                </div>
                                <div className="space-y-1 p-3 bg-muted/30 rounded-lg">
                                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tahun Register</label>
                                    <p className="flex items-center gap-2 text-sm">
                                        <Clock className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                                        {surat.tahun || '-'}
                                    </p>
                                </div>
                                <div className="space-y-1 p-3 bg-muted/30 rounded-lg">
                                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Unit Kerja</label>
                                    <p className="text-sm font-medium">{surat.unitKerjaId || '-'}</p>
                                </div>
                            </div>

                            <Separator />

                            {/* Recipient/Signer */}
                            <div className="grid grid-cols-1 gap-4">
                                <div className="space-y-2 p-4 border rounded-xl bg-gradient-to-br from-violet-50/50 to-purple-50/50 dark:from-violet-950/20 dark:to-purple-950/20">
                                    <label className="text-xs font-semibold text-violet-700 dark:text-violet-400 uppercase tracking-wide flex items-center gap-1">
                                        <Building className="h-3 w-3" />
                                        Kepada
                                    </label>
                                    <p className="font-medium">{surat.kepada}</p>
                                </div>
                            </div>

                            {/* Type & Classification */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Jenis Surat</label>
                                    <p className="text-sm font-medium">{surat.naskahDinas || '-'}</p>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Klasifikasi Fasilitatif</label>
                                    <p className="text-sm font-medium">
                                        {surat.klasifikasiFasilitatifKode || surat.klasifikasiFasilitatif || '-'}
                                    </p>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Klasifikasi Substantif</label>
                                    <p className="text-sm font-medium">
                                        {surat.klasifikasiSubstantifKode || surat.klasifikasiSubstantif || '-'}
                                    </p>
                                </div>
                            </div>

                            {/* Balasan dari Surat Masuk */}
                            {surat.balasanUntuk && (
                                <>
                                    <Separator />
                                    <div className="space-y-2">
                                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Balasan dari Surat Masuk</label>
                                        <Button variant="outline" size="sm" asChild className="group">
                                            <Link to={`/surat/masuk/${surat.balasanUntuk}`}>
                                                <MailOpen className="mr-2 h-4 w-4 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors" />
                                                Lihat Surat Masuk
                                            </Link>
                                        </Button>
                                    </div>
                                </>
                            )}

                            {/* Link Dokumen */}
                            {surat.linkDokumen && (
                                <>
                                    <Separator />
                                    <div className="space-y-2">
                                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Link Dokumen</label>
                                        <a
                                            href={surat.linkDokumen}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-100 dark:border-blue-900/50 hover:bg-blue-100 dark:hover:bg-blue-950/50 transition-colors group"
                                        >
                                            <div className="bg-blue-500 p-2 rounded-lg">
                                                <Link2 className="h-4 w-4 text-white" />
                                            </div>
                                            <span className="text-blue-700 dark:text-blue-300 group-hover:underline truncate flex-1">
                                                {surat.linkDokumen}
                                            </span>
                                            <ExternalLink className="h-4 w-4 text-blue-500 shrink-0" />
                                        </a>
                                    </div>
                                </>
                            )}

                        </CardContent>
                    </Card>

                    {/* File Preview Card */}
                    {fileUrl && (
                        <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden">
                            <CardHeader className="pb-3">
                                <CardTitle className="flex items-center gap-2">
                                    <FileText className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                                    Dokumen Lampiran
                                </CardTitle>
                                <CardDescription className="flex items-center gap-2">
                                    <span className="font-mono text-xs bg-muted px-2 py-1 rounded">{fileName}</span>
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="p-0">
                                <div className="border-t bg-muted/20">
                                    {isPdf(fileName) ? (
                                        <iframe
                                            src={`${fileUrl}#toolbar=1&navpanes=0`}
                                            className="w-full h-[600px]"
                                            title="PDF Preview"
                                        />
                                    ) : isImage(fileName) ? (
                                        <div className="flex justify-center p-6 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2220%22%20height%3D%2220%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cdefs%3E%3Cpattern%20id%3D%22grid%22%20width%3D%2220%22%20height%3D%2220%22%20patternUnits%3D%22userSpaceOnUse%22%3E%3Crect%20width%3D%2210%22%20height%3D%2210%22%20fill%3D%22%23f0f0f0%22%2F%3E%3Crect%20x%3D%2210%22%20y%3D%2210%22%20width%3D%2210%22%20height%3D%2210%22%20fill%3D%22%23f0f0f0%22%2F%3E%3C%2Fpattern%3E%3C%2Fdefs%3E%3Crect%20fill%3D%22url(%23grid)%22%20width%3D%22100%25%22%20height%3D%22100%25%22%2F%3E%3C%2Fsvg%3E')]">
                                            <img
                                                src={fileUrl}
                                                alt={fileName}
                                                className="max-w-full max-h-[600px] object-contain rounded-lg shadow-xl"
                                            />
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center py-16">
                                            <div className="bg-muted p-4 rounded-full mb-4">
                                                <FileText className="h-12 w-12 text-muted-foreground" />
                                            </div>
                                            <p className="text-muted-foreground mb-2">Preview tidak tersedia untuk file ini</p>
                                            <p className="text-sm text-muted-foreground">Download file untuk melihat isi dokumen</p>
                                        </div>
                                    )}
                                </div>

                                <div className="flex gap-2 p-4 border-t bg-muted/10">
                                    <Button variant="outline" className="flex-1" asChild>
                                        <a href={downloadUrl}>
                                            <Download className="mr-2 h-4 w-4" />
                                            Download
                                        </a>
                                    </Button>
                                    <Button variant="outline" className="flex-1" asChild>
                                        <a href={fileUrl} target="_blank" rel="noopener noreferrer">
                                            <ExternalLink className="mr-2 h-4 w-4" />
                                            Buka di Tab Baru
                                        </a>
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </div>

                {/* Sidebar */}
                <div className="space-y-6">
                    {/* Status Card */}
                    <Card className="shadow-sm overflow-hidden">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">Status</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 pt-0">
                            {/* Approval Status */}
                            <div className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${approvalStatus === 'approved'
                                ? 'bg-green-50 dark:bg-green-950/30 border border-green-100 dark:border-green-900/50'
                                : approvalStatus === 'rejected'
                                    ? 'bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/50'
                                    : 'bg-amber-50 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-900/50'
                                }`}>
                                <div className={`p-2 rounded-full ${approvalStatus === 'approved'
                                    ? 'bg-green-100 dark:bg-green-900/50'
                                    : 'bg-amber-100 dark:bg-amber-900/50'
                                    }`}>
                                    {approvalStatus === 'approved' ? (
                                        <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                                    ) : (
                                        <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                                    )}
                                </div>
                                <div>
                                    <p className={`font-medium text-sm ${approvalStatus === 'approved'
                                        ? 'text-green-700 dark:text-green-300'
                                        : 'text-amber-700 dark:text-amber-300'
                                        }`}>
                                        {approvalStatusLabel}
                                    </p>
                                    <p className="text-xs text-muted-foreground">Status persetujuan surat</p>
                                </div>
                            </div>

                            {/* Archive Status */}
                            <div className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${surat.isArchived
                                ? 'bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/50'
                                : 'bg-muted/50 dark:bg-foreground/30 border border-border dark:border-gray-800'
                                }`}>
                                <div className={`p-2 rounded-full ${surat.isArchived
                                    ? 'bg-blue-100 dark:bg-blue-900/50'
                                    : 'bg-muted dark:bg-foreground'
                                    }`}>
                                    <Archive className={`h-4 w-4 ${surat.isArchived
                                        ? 'text-blue-600 dark:text-blue-400'
                                        : 'text-muted-foreground'
                                        }`} />
                                </div>
                                <div>
                                    <p className={`font-medium text-sm ${surat.isArchived
                                        ? 'text-blue-700 dark:text-blue-300'
                                        : 'text-muted-foreground dark:text-muted-foreground'
                                        }`}>
                                        {surat.isArchived ? 'Sudah Diarsipkan' : 'Belum Diarsipkan'}
                                    </p>
                                    <p className="text-xs text-muted-foreground">Status arsip</p>
                                </div>
                            </div>

                            {surat.isArchived && surat.arsipId && (
                                <Button variant="outline" className="w-full" size="sm" asChild>
                                    <Link to={`/arsip?id=${surat.arsipId}`}>
                                        <Eye className="mr-2 h-4 w-4" />
                                        Lihat di Arsip
                                    </Link>
                                </Button>
                            )}
                        </CardContent>
                    </Card>

                    {/* Metadata Card */}
                    <Card className="shadow-sm">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">Metadata</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm pt-0">
                            <div className="flex justify-between items-start">
                                <span className="text-muted-foreground">Dibuat pada</span>
                                <div className="text-right">
                                    <span className="block">{formatDate(surat.createdAt)}</span>
                                    <span className="text-xs text-muted-foreground">{formatRelativeTime(surat.createdAt)}</span>
                                </div>
                            </div>
                            <Separator />
                            <div className="flex justify-between items-start">
                                <span className="text-muted-foreground">Diubah pada</span>
                                <div className="text-right">
                                    <span className="block">{formatDate(surat.updatedAt)}</span>
                                    <span className="text-xs text-muted-foreground">{formatRelativeTime(surat.updatedAt)}</span>
                                </div>
                            </div>
                            {surat.unitKerjaId && (
                                <>
                                    <Separator />
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Unit Kerja</span>
                                        <Badge variant="outline">{surat.unitKerjaId}</Badge>
                                    </div>
                                </>
                            )}
                        </CardContent>
                    </Card>

                    {/* Approval Workflow */}
                    {isAdmin && (
                        <Card className="shadow-sm">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base">Alur Persetujuan</CardTitle>
                                <CardDescription>
                                    Persetujuan internal ini tidak menggunakan tanda tangan elektronik BSrE/PSrE.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3 pt-0">
                                {canSubmitApproval && (
                                    <Button
                                        className="w-full"
                                        disabled={approvers.length === 0}
                                        onClick={() => openApprovalDialog('submit')}
                                    >
                                        <Send className="mr-2 h-4 w-4" />
                                        Ajukan Persetujuan
                                    </Button>
                                )}
                                {canSubmitApproval && approvers.length === 0 && (
                                    <p className="text-xs text-amber-700 dark:text-amber-300">
                                        Belum ada administrator aktif lain yang dapat menjadi penyetuju pada unit ini.
                                    </p>
                                )}
                                {isCurrentApprover && (
                                    <div className="grid grid-cols-2 gap-2">
                                        <Button onClick={() => openApprovalDialog('approve')}>
                                            <CheckCircle className="mr-2 h-4 w-4" /> Setujui
                                        </Button>
                                        <Button variant="destructive" onClick={() => openApprovalDialog('reject')}>
                                            <AlertCircle className="mr-2 h-4 w-4" /> Tolak
                                        </Button>
                                    </div>
                                )}
                                {approvalStatus === 'pending' && !isCurrentApprover && (
                                    <p className="text-sm text-muted-foreground">
                                        Surat sedang menunggu keputusan penyetuju yang ditunjuk.
                                    </p>
                                )}
                                {approvalStatus === 'approved' && !surat.isArchived && (
                                    <p className="text-sm text-emerald-700 dark:text-emerald-300">
                                        Persetujuan final selesai. Surat sudah dapat diregistrasikan ke modul Arsip.
                                    </p>
                                )}
                                {approvalHistory.length > 0 && (
                                    <div className="space-y-2 border-t pt-3">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Riwayat</p>
                                        {approvalHistory.map((item, index) => (
                                            <div key={`${item.createdAt}-${index}`} className="rounded-md border p-2 text-xs">
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="font-semibold">{item.action}</span>
                                                    <span className="text-muted-foreground">{formatDate(item.createdAt)}</span>
                                                </div>
                                                <p>{item.userName || item.userRole || '-'}</p>
                                                {item.notes && <p className="mt-1 text-muted-foreground">{item.notes}</p>}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {/* Quick Actions Card - Admin only */}
                    {isAdmin && (canEdit || canArchive) && (
                        <Card className="shadow-sm">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base">Aksi Cepat</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2 pt-0">
                                {canEdit && (
                                    <Button
                                        variant="outline"
                                        className="w-full justify-start hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 dark:hover:bg-blue-950/30 dark:hover:text-blue-300 transition-colors"
                                        onClick={() => navigate(`/surat/keluar/edit/${surat.id}`)}
                                    >
                                        <Edit className="mr-2 h-4 w-4" />
                                        Edit Surat
                                    </Button>
                                )}
                                {canArchive && (
                                    <Button
                                        variant="outline"
                                        className="w-full justify-start hover:bg-purple-50 dark:hover:bg-purple-500/15 hover:text-purple-700 dark:hover:text-purple-300 hover:border-purple-200 dark:hover:bg-purple-950/30 dark:hover:text-purple-300 transition-colors"
                                        onClick={() => setArchiveDialogOpen(true)}
                                    >
                                        <Archive className="mr-2 h-4 w-4" />
                                        Arsipkan
                                    </Button>
                                )}
                            </CardContent>
                        </Card>
                    )}
                </div>
            </div>

            {/* Archive Dialog */}
            <ArchiveDialog
                open={archiveDialogOpen}
                onOpenChange={setArchiveDialogOpen}
                suratType="keluar"
                suratData={{
                    id: surat.id,
                    nomorSurat: surat.nomorSurat,
                    perihal: surat.perihal,
                    tanggalSurat: surat.tanggalSurat,
                }}
                onArchive={handleArchive}
            />

            <Dialog
                open={Boolean(approvalAction)}
                onOpenChange={(open) => {
                    if (!open && !approvalBusy) setApprovalAction(null)
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {approvalAction === 'submit'
                                ? 'Ajukan Persetujuan'
                                : approvalAction === 'approve'
                                    ? 'Setujui Surat'
                                    : 'Tolak Surat'}
                        </DialogTitle>
                        <DialogDescription>
                            Keputusan dan catatan akan disimpan sebagai riwayat alur surat.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        {approvalAction === 'submit' && (
                            <div className="space-y-2">
                                <Label htmlFor="approval-approver">Penyetuju</Label>
                                <select
                                    id="approval-approver"
                                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                                    value={selectedApproverId}
                                    onChange={(event) => setSelectedApproverId(event.target.value)}
                                    disabled={approvalBusy}
                                >
                                    <option value="">Pilih administrator aktif</option>
                                    {approvers.map(approver => (
                                        <option key={approver.id} value={approver.id}>
                                            {approver.name} ({approver.role})
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                        <div className="space-y-2">
                            <Label htmlFor="approval-notes">
                                {approvalAction === 'reject' ? 'Alasan penolakan' : 'Catatan (opsional)'}
                            </Label>
                            <Textarea
                                id="approval-notes"
                                rows={4}
                                maxLength={2000}
                                value={approvalNotes}
                                onChange={(event) => setApprovalNotes(event.target.value)}
                                disabled={approvalBusy}
                                placeholder={approvalAction === 'reject'
                                    ? 'Jelaskan bagian yang harus diperbaiki.'
                                    : 'Tambahkan catatan telaah bila diperlukan.'}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={approvalBusy}
                            onClick={() => setApprovalAction(null)}
                        >
                            Batal
                        </Button>
                        <Button
                            type="button"
                            variant={approvalAction === 'reject' ? 'destructive' : 'default'}
                            disabled={
                                approvalBusy
                                || (approvalAction === 'submit' && !selectedApproverId)
                                || (approvalAction === 'reject' && !approvalNotes.trim())
                            }
                            onClick={handleApprovalAction}
                        >
                            {approvalBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Simpan
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
