import { Button } from '@/components/ui/button'
import { useState } from 'react'
import { useAppConfig } from '@/context/app-config-context'
import { Textarea } from '@/components/ui/textarea'
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CheckCircle, XCircle } from 'lucide-react'
import PreservationHistory from '@/components/arsip-elektronik/PreservationHistory'
import PreservationActionForm from '@/components/arsip-elektronik/PreservationActionForm'
import { formatFileSize } from './constants'

export default function ArsipElektronikDetail({
    open, onOpenChange, selectedItem, verifyNote, setVerifyNote, onVerify
}) {
    const [preservationRevision, setPreservationRevision] = useState(0)
    const { capabilities } = useAppConfig()
    const advancedWorkflowsEnabled = capabilities.advancedArchiveWorkflows !== false
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Detail & Verifikasi Dokumen</DialogTitle>
                </DialogHeader>
                {selectedItem && (
                    <Tabs key={advancedWorkflowsEnabled ? 'full' : 'manual'} defaultValue="detail" className="w-full">
                        <TabsList className={`grid w-full ${advancedWorkflowsEnabled ? 'grid-cols-2' : 'grid-cols-1'}`}>
                            <TabsTrigger value="detail">Detail & Verifikasi</TabsTrigger>
                            {advancedWorkflowsEnabled && <TabsTrigger value="preservasi">Preservasi Digital</TabsTrigger>}
                        </TabsList>

                        <TabsContent value="detail" className="space-y-4 pt-4">
                            <div className="space-y-3">
                                <div className="grid grid-cols-2 gap-2 text-sm">
                                    <div className="col-span-2"><span className="text-muted-foreground">Kode registrasi:</span> <strong className="font-mono">{selectedItem.registrationCode || 'Rekod legacy'}</strong></div>
                                    <div><span className="text-muted-foreground">Format:</span> <strong>{selectedItem.formatFile}</strong></div>
                                    <div><span className="text-muted-foreground">Ukuran:</span> <strong>{formatFileSize(selectedItem.ukuranFile)}</strong></div>
                                    <div><span className="text-muted-foreground">Resolusi:</span> <strong>{selectedItem.resolusiDPI ? `${selectedItem.resolusiDPI} DPI` : '-'}</strong></div>
                                    <div><span className="text-muted-foreground">Halaman:</span> <strong>{selectedItem.jumlahHalaman || '-'}</strong></div>
                                    <div><span className="text-muted-foreground">Media:</span> <strong>{selectedItem.mediaAsal} → {selectedItem.mediaTujuan}</strong></div>
                                    <div><span className="text-muted-foreground">Versi:</span> <strong>v{selectedItem.versiDokumen}</strong></div>
                                    <div><span className="text-muted-foreground">Sumber:</span> <strong>{selectedItem.sourceType || '-'}</strong></div>
                                    <div><span className="text-muted-foreground">Kedalaman warna:</span> <strong>{selectedItem.colorDepth ? `${selectedItem.colorDepth}-bit` : '-'}</strong></div>
                                    <div><span className="text-muted-foreground">Kendali mutu:</span> <strong>{selectedItem.qcStatus || 'pending'}</strong></div>
                                </div>
                                {selectedItem.qcNotes && (
                                    <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{selectedItem.qcNotes}</p>
                                )}
                                {selectedItem.hashSHA256 && (
                                    <div className="text-xs">
                                        <span className="text-muted-foreground">SHA-256:</span>
                                        <code className="block bg-muted p-1.5 rounded mt-1 break-all">{selectedItem.hashSHA256}</code>
                                    </div>
                                )}
                                {selectedItem.catatanKonversi && (
                                    <div className="text-sm">
                                        <span className="text-muted-foreground">Catatan:</span>
                                        <p className="mt-1">{selectedItem.catatanKonversi}</p>
                                    </div>
                                )}
                                <div>
                                    <label className="text-sm font-medium">Catatan Verifikasi</label>
                                    <Textarea
                                        placeholder="Catatan opsional..."
                                        value={verifyNote}
                                        onChange={(e) => setVerifyNote(e.target.value)}
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="destructive" onClick={() => onVerify('rejected')}>
                                    <XCircle className="mr-1 h-4 w-4" /> Tolak
                                </Button>
                                <Button onClick={() => onVerify('verified')} disabled={selectedItem.qcStatus !== 'passed'}>
                                    <CheckCircle className="mr-1 h-4 w-4" /> Verifikasi
                                </Button>
                            </DialogFooter>
                        </TabsContent>

                        {advancedWorkflowsEnabled && <TabsContent value="preservasi" className="space-y-4 pt-4">
                            <div className="flex justify-between items-center bg-muted/30 p-4 rounded-lg">
                                <div className="space-y-1">
                                    <h4 className="text-sm font-medium">Tindakan Preservasi</h4>
                                    <p className="text-xs text-muted-foreground">
                                        Catat tindakan seperti migrasi, konversi, atau pengecekan integritas.
                                    </p>
                                </div>
                                <PreservationActionForm
                                    key={selectedItem.id}
                                    arsipId={selectedItem.id}
                                    onSuccess={() => setPreservationRevision(value => value + 1)}
                                />
                            </div>
                            <div className="max-h-[400px] overflow-auto pr-1">
                                <PreservationHistory arsipId={selectedItem.id} refreshVersion={preservationRevision} />
                            </div>
                        </TabsContent>}
                    </Tabs>
                )}
            </DialogContent>
        </Dialog>
    )
}
