import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, AlertCircle, Loader2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { ArchiveDialog } from '@/components/ArchiveDialog'
import { DistributeDialog } from '@/components/DistributeDialog'
import suratMasukService from '@/services/surat-masuk.service'
import { useAuth } from '@/context/AuthContext'

// Extracted Components
import { DetailHeader } from '@/components/surat-masuk/DetailHeader'
import { InfoSection } from '@/components/surat-masuk/InfoSection'
import { FilePreviewSection } from '@/components/surat-masuk/FilePreviewSection'
import { StatusSidebar } from '@/components/surat-masuk/StatusSidebar'

export default function SuratMasukDetail() {
    const { id } = useParams()
    const navigate = useNavigate()
    const { toast } = useToast()
    const { canWrite, user } = useAuth()
    const isAdmin = canWrite()

    const [surat, setSurat] = useState(null)
    const [loading, setLoading] = useState(true)
    const [archiveDialogOpen, setArchiveDialogOpen] = useState(false)
    const [distributeDialogOpen, setDistributeDialogOpen] = useState(false)

    useEffect(() => {
        fetchSurat()
    }, [id])

    const fetchSurat = async () => {
        setLoading(true)
        try {
            const data = await suratMasukService.getById(id)
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
    }

    const handleArchive = async (metadata) => {
        try {
            await suratMasukService.archive(surat.id, metadata)
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

    const handleReply = () => {
        navigate('/surat/keluar/tambah', {
            state: {
                replyTo: {
                    id: surat.id,
                    nomorSurat: surat.nomorSurat,
                    perihal: surat.perihal,
                    dari: surat.dari,
                }
            }
        })
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
                onReply={handleReply}
                onDistribute={() => setDistributeDialogOpen(true)}
                onArchive={() => setArchiveDialogOpen(true)}
                isAdmin={isAdmin}
            />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Main Content */}
                <div className="lg:col-span-2 space-y-6">
                    <InfoSection surat={surat} />
                    <FilePreviewSection surat={surat} />
                </div>

                {/* Sidebar */}
                <div className="space-y-6">
                    <StatusSidebar
                        surat={surat}
                        onEdit={() => navigate(`/surat/masuk/edit/${surat.id}`)}
                        onReply={handleReply}
                        onDistribute={() => setDistributeDialogOpen(true)}
                        onArchive={() => setArchiveDialogOpen(true)}
                        isAdmin={isAdmin}
                    />
                </div>
            </div>

            {/* Dialogs */}
            <ArchiveDialog
                open={archiveDialogOpen}
                onOpenChange={setArchiveDialogOpen}
                suratType="masuk"
                suratData={{
                    id: surat.id,
                    nomorSurat: surat.nomorSurat,
                    perihal: surat.perihal,
                    tanggalSurat: surat.tanggalSurat,
                }}
                onArchive={handleArchive}
            />

            <DistributeDialog
                open={distributeDialogOpen}
                onOpenChange={setDistributeDialogOpen}
                suratData={{
                    id: surat.id,
                    nomorSurat: surat.nomorSurat,
                    perihal: surat.perihal,
                }}
                sourceUnitId={user?.unitKerjaId || 'ditjen'}
                onSuccess={() => {
                    setDistributeDialogOpen(false)
                    toast({
                        title: 'Berhasil',
                        description: 'Surat berhasil didistribusikan',
                    })
                }}
            />
        </div>
    )
}
