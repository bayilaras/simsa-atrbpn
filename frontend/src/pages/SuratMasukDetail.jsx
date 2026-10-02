import { useCallback, useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, AlertCircle, Loader2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { ArchiveDialog } from '@/components/ArchiveDialog'
import { DistributeDialog } from '@/components/DistributeDialog'
import suratMasukService from '@/services/surat-masuk.service'
import distributionService from '@/services/distribution.service'
import { useAuth } from '@/context/AuthContext'
import { resolveEffectiveUnitKerjaId } from '@/lib/unit-kerja-scope'

// Extracted Components
import { DetailHeader } from '@/components/surat-masuk/DetailHeader'
import { InfoSection } from '@/components/surat-masuk/InfoSection'
import { FilePreviewSection } from '@/components/surat-masuk/FilePreviewSection'
import { StatusSidebar } from '@/components/surat-masuk/StatusSidebar'
import { AlurSuratPanel } from '@/components/surat/AlurSuratPanel'
import { TautkanDialog } from '@/components/surat/AlurSuratActions'
import { PenyelesaianDialog } from '@/components/distribusi/PenyelesaianDialog'

export default function SuratMasukDetail() {
    const { id } = useParams()
    const navigate = useNavigate()
    const { toast } = useToast()
    const { canWrite, user } = useAuth()

    const [surat, setSurat] = useState(null)
    const aksesMelalui = surat?.aksesMelalui ?? 'owner'
    const isAdmin = Boolean(surat && aksesMelalui === 'owner' && canWrite(surat.unitKerjaId))
    const [loading, setLoading] = useState(true)
    const [archiveDialogOpen, setArchiveDialogOpen] = useState(false)
    const [distributeDialogOpen, setDistributeDialogOpen] = useState(false)
    const [tautkanOpen, setTautkanOpen] = useState(false)
    const [penyelesaianTarget, setPenyelesaianTarget] = useState(null)
    // Sinyal reload AlurSuratPanel yang dikendalikan halaman ini (N1): dinaikkan
    // hanya setelah Terima/Arsip/Distribusi SUKSES, tidak pernah dari refresh
    // yang dipicu onChanged panel sendiri -- lihat komentar muatUlangKe di
    // AlurSuratPanel.jsx.
    const [alurVersi, setAlurVersi] = useState(0)
    // Sekali surat termuat untuk id ini, refresh berikutnya (mis. dari
    // onChanged AlurSuratPanel, atau setelah Terima/Arsip/Distribusi) bersifat
    // diam: tidak menyalakan `loading`, sehingga gerbang `if (loading) return
    // <spinner>` di bawah tidak membongkar seluruh halaman (dan AlurSuratPanel
    // di dalamnya) pada setiap refresh (F1).
    const termuatRef = useRef(false)
    useEffect(() => { termuatRef.current = false }, [id])

    const fetchSurat = useCallback(async () => {
        const diam = termuatRef.current
        if (!diam) setLoading(true)
        try {
            const data = await suratMasukService.getById(id)
            setSurat(data)
            termuatRef.current = true
        } catch (error) {
            console.error('Error fetching surat:', error)
            toast({
                title: 'Error',
                description: 'Gagal memuat data surat',
                variant: 'destructive',
            })
        } finally {
            if (!diam) setLoading(false)
        }
    }, [id, toast])

    useEffect(() => {
        void fetchSurat()
    }, [fetchSurat])

    const handleArchive = async (metadata) => {
        try {
            await suratMasukService.archive(surat.id, metadata)
            toast({
                title: 'Berhasil Diarsipkan',
                description: `Surat ${surat.nomorSurat} telah diarsipkan`,
            })
            fetchSurat()
            setAlurVersi((v) => v + 1)
        } catch (error) {
            toast({
                title: 'Error',
                description: error.message || 'Gagal mengarsipkan surat',
                variant: 'destructive',
            })
            throw error
        }
    }

    const handleTerima = async () => {
        try {
            await distributionService.receive(surat.distribusiUnitSaya.id, resolveEffectiveUnitKerjaId(user))
            toast({ title: 'Berhasil', description: 'Disposisi diterima' })
            fetchSurat()
            setAlurVersi((v) => v + 1)
        } catch (error) {
            toast({ title: 'Error', description: error.message || 'Gagal menerima disposisi', variant: 'destructive' })
        }
    }
    // F-I2: Penyelesaian dibuka langsung di halaman ini dengan disposisi yang
    // dimuat lewat GET /api/distributions/:id (tidak bergantung pada halaman 1
    // Kotak Disposisi). Hanya disposisi terbaca yang masih sent/received.
    const handlePenyelesaian = async () => {
        try {
            const distribusi = await distributionService.getById(surat.distribusiUnitSaya.id)
            if (!distribusi || distribusi.masked || (distribusi.status !== 'sent' && distribusi.status !== 'received')) {
                toast({
                    title: 'Disposisi tidak dapat diselesaikan',
                    description: 'Disposisi sudah selesai/ditolak atau belum dapat Anda baca.',
                    variant: 'destructive',
                })
                fetchSurat()
                return
            }
            setPenyelesaianTarget(distribusi)
        } catch (error) {
            toast({ title: 'Error', description: error.message || 'Gagal memuat disposisi', variant: 'destructive' })
        }
    }
    const handlePenyelesaianSelesai = () => {
        fetchSurat()
        setAlurVersi((v) => v + 1)
    }
    const handleTautkanBerhasil = () => {
        toast({ title: 'Berhasil', description: 'Surat ditautkan ke rangkaian' })
        fetchSurat()
        setAlurVersi((v) => v + 1)
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="flex flex-col items-center gap-4">
                    <div className="relative">
                        <div className="absolute inset-0 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full blur-xl opacity-30 animate-pulse" />
                        <Loader2 className="h-12 w-12 animate-spin text-emerald-600 dark:text-emerald-400 relative" />
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
                        <Button className="mt-6" onClick={() => navigate('/surat/masuk')}>
                            Kembali ke Daftar Surat
                        </Button>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* Breadcrumb - Optional, can be in DetailHeader or here. Keeping navigation lean here. */}

            <DetailHeader
                surat={surat}
                onBack={() => navigate(-1)}
                onEdit={() => navigate(`/surat/masuk/edit/${surat.id}`)}
                onDistribute={() => setDistributeDialogOpen(true)}
                onArchive={() => setArchiveDialogOpen(true)}
                onTerima={handleTerima}
                onPenyelesaian={handlePenyelesaian}
                onTautkan={() => setTautkanOpen(true)}
                isAdmin={isAdmin}
            />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Main Content */}
                <div className="lg:col-span-2 space-y-6">
                    <InfoSection surat={surat} />
                    <AlurSuratPanel jenis="surat_masuk" suratId={surat.id} aksesMelalui={aksesMelalui} onChanged={fetchSurat} muatUlangKe={alurVersi} />
                    <FilePreviewSection surat={surat} />
                </div>

                {/* Sidebar */}
                <div className="space-y-6">
                    <StatusSidebar
                        surat={surat}
                        onEdit={() => navigate(`/surat/masuk/edit/${surat.id}`)}
                        onDistribute={() => setDistributeDialogOpen(true)}
                        onArchive={() => setArchiveDialogOpen(true)}
                        onTerima={handleTerima}
                        onPenyelesaian={handlePenyelesaian}
                        isAdmin={isAdmin}
                    />
                </div>
            </div>

            {/* Dialogs */}
            <ArchiveDialog
                open={archiveDialogOpen}
                onOpenChange={setArchiveDialogOpen}
                suratType="masuk"
                suratData={surat}
                onArchive={handleArchive}
            />

            <PenyelesaianDialog
                open={Boolean(penyelesaianTarget)}
                onOpenChange={(buka) => { if (!buka) setPenyelesaianTarget(null) }}
                distribusi={penyelesaianTarget}
                unitKerjaId={resolveEffectiveUnitKerjaId(user)}
                onSelesai={handlePenyelesaianSelesai}
            />

            <TautkanDialog
                open={tautkanOpen}
                onOpenChange={setTautkanOpen}
                jenis="surat_masuk"
                surat={surat}
                onBerhasil={handleTautkanBerhasil}
            />

            <DistributeDialog
                open={distributeDialogOpen}
                onOpenChange={setDistributeDialogOpen}
                suratData={{
                    id: surat.id,
                    nomorSurat: surat.nomorSurat,
                    perihal: surat.perihal,
                    sifatSurat: surat.sifatSurat,
                }}
                sourceUnitId={surat.unitKerjaId || resolveEffectiveUnitKerjaId(user)}
                onSuccess={() => {
                    setDistributeDialogOpen(false)
                    toast({
                        title: 'Berhasil',
                        description: 'Surat berhasil didistribusikan',
                    })
                    fetchSurat()
                    setAlurVersi((v) => v + 1)
                }}
            />
        </div>
    )
}
