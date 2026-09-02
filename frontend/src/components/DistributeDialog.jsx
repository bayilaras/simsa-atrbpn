import { useCallback, useState, useEffect } from 'react'
import { Send, Loader2 } from 'lucide-react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import distributionService from '@/services/distribution.service'

/**
 * Dialog for distributing a surat to another unit
 * @param {Object} props
 * @param {boolean} props.open - Whether dialog is open
 * @param {Function} props.onOpenChange - Handler for open state change
 * @param {Object} props.suratData - Selected surat data { id, nomorSurat, perihal }
 * @param {string} props.sourceUnitId - Current user's unit ID
 * @param {Function} props.onSuccess - Callback after successful distribution
 */
export function DistributeDialog({ open, onOpenChange, suratData, sourceUnitId, onSuccess }) {
    const { toast } = useToast()
    const [loading, setLoading] = useState(false)
    const [units, setUnits] = useState([])
    const [loadingUnits, setLoadingUnits] = useState(false)
    const [targetUnitId, setTargetUnitId] = useState('')
    const [instruction, setInstruction] = useState('')

    const loadUnits = useCallback(async () => {
        setLoadingUnits(true)
        try {
            const response = await distributionService.getDistributableUnits(sourceUnitId)
            setUnits(Array.isArray(response) ? response : [])
        } catch (error) {
            console.error('Error loading units:', error)
            toast({
                title: 'Error',
                description: 'Gagal memuat daftar unit kerja',
                variant: 'destructive',
            })
        } finally {
            setLoadingUnits(false)
        }
    }, [sourceUnitId, toast])

    // Load distributable units when dialog opens.
    useEffect(() => {
        if (open && sourceUnitId) {
            void loadUnits()
        }
    }, [loadUnits, open, sourceUnitId])

    const handleSubmit = async () => {
        if (!sourceUnitId) {
            toast({
                title: 'Unit kerja belum dipilih',
                description: 'Distribusi memerlukan unit sumber yang konkret.',
                variant: 'destructive',
            })
            return
        }
        if (!targetUnitId) {
            toast({
                title: 'Validasi',
                description: 'Pilih unit tujuan terlebih dahulu',
                variant: 'destructive',
            })
            return
        }

        setLoading(true)
        try {
            await distributionService.distribute({
                suratMasukId: suratData.id,
                sourceUnitId,
                targetUnitId,
                instruction: instruction || null,
            })

            toast({
                title: 'Berhasil',
                description: `Surat berhasil didistribusikan ke ${units.find(u => u.id === targetUnitId)?.name}`,
            })

            // Reset form
            setTargetUnitId('')
            setInstruction('')
            onOpenChange(false)
            onSuccess?.()
        } catch (error) {
            console.error('Error distributing:', error)
            toast({
                title: 'Error',
                description: error.response?.data?.error || 'Gagal mendistribusikan surat',
                variant: 'destructive',
            })
        } finally {
            setLoading(false)
        }
    }

    const handleClose = () => {
        if (!loading) {
            setTargetUnitId('')
            setInstruction('')
            onOpenChange(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Send className="h-5 w-5 text-primary" />
                        Distribusikan Surat
                    </DialogTitle>
                    <DialogDescription>
                        Kirim surat ini ke unit kerja tujuan untuk ditindaklanjuti
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {/* Surat Info */}
                    {suratData && (
                        <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Nomor Surat:</span>
                                <span className="font-medium">{suratData.nomorSurat}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Perihal:</span>
                                <span className="font-medium truncate max-w-[250px]">{suratData.perihal}</span>
                            </div>
                        </div>
                    )}

                    {/* Target Unit Selection */}
                    <div className="space-y-2">
                        <Label htmlFor="targetUnit">Unit Tujuan <span className="text-destructive">*</span></Label>
                        <Select value={targetUnitId} onValueChange={setTargetUnitId} disabled={loadingUnits}>
                            <SelectTrigger>
                                <SelectValue placeholder={loadingUnits ? "Memuat..." : "Pilih Unit Tujuan"} />
                            </SelectTrigger>
                            <SelectContent>
                                {units.map((unit) => (
                                    <SelectItem key={unit.id} value={unit.id}>
                                        <div className="flex items-center gap-2">
                                            <span>{unit.name}</span>
                                            {unit.unitType && (
                                                <span className="text-xs text-muted-foreground">
                                                    ({unit.unitType})
                                                </span>
                                            )}
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Instruction */}
                    <div className="space-y-2">
                        <Label htmlFor="instruction">Instruksi / Catatan</Label>
                        <Textarea
                            id="instruction"
                            placeholder="Contoh: Mohon ditindaklanjuti sesuai tugas pokok dan fungsi..."
                            value={instruction}
                            onChange={(e) => setInstruction(e.target.value)}
                            rows={3}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={handleClose} disabled={loading}>
                        Batal
                    </Button>
                    <Button onClick={handleSubmit} disabled={loading || !sourceUnitId || !targetUnitId}>
                        {loading ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Mengirim...
                            </>
                        ) : (
                            <>
                                <Send className="mr-2 h-4 w-4" />
                                Distribusikan
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
