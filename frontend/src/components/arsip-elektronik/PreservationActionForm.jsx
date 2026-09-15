import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/services/api';
import { Save, PlusCircle } from 'lucide-react';
import ExternalPreservationFields from './ExternalPreservationFields';

export default function PreservationActionForm({ arsipId, onSuccess }) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const { toast } = useToast();

    const [formData, setFormData] = useState({
        action: '',
        details: '',
        notes: ''
    });

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSelectChange = (value) => {
        setFormData(prev => ({ ...prev, action: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const { action, details, notes } = formData;
            const payload = { action, details, notes };
            if (action !== 'integrity_check') Object.assign(payload, {
                outputAttachmentId: formData.outputAttachmentId, evidenceAttachmentId: formData.evidenceAttachmentId,
                toolName: formData.toolName, toolVersion: formData.toolVersion,
                activityAt: new Date(formData.activityAt).toISOString(),
            });
            const result = await api.post(`/api/arsip-elektronik/${arsipId}/preservasi`, payload);
            const mismatch = result.evidenceSnapshot?.result === 'mismatch';

            toast({
                title: mismatch ? 'Integritas tidak cocok' : 'Pencatatan selesai',
                description: mismatch ? 'Hash sumber tidak cocok. Periksa berkas dan tindak lanjuti kerusakan.'
                    : action === 'integrity_check' ? 'Hash bitstream sesuai baseline.' : 'Bukti tindakan eksternal tersimpan; SIMSA tidak menjalankan konversi.',
                ...(mismatch ? { variant: 'destructive' } : {}),
            });

            setOpen(false);
            setFormData({ action: '', details: '', notes: '' });
            if (onSuccess) onSuccess();
        } catch (error) {
            setError(error.message || 'Pencatatan gagal');
            console.error('Error recording preservation action:', error);
            toast({
                title: 'Gagal',
                description: error.message || 'Gagal mencatat tindakan preservasi',
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                    <PlusCircle className="h-4 w-4" />
                    Catat Preservasi
                </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
                <DialogHeader>
                    <DialogTitle>Catat Tindakan Preservasi</DialogTitle>
                    <DialogDescription>
                        Cek integritas membaca bitstream secara langsung. Tindakan lain dicatat sebagai kegiatan eksternal dengan bukti.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                    <div className="space-y-2">
                        <Label htmlFor="action">Jenis Tindakan</Label>
                        <Select value={formData.action} onValueChange={handleSelectChange} required>
                            <SelectTrigger id="action">
                                <SelectValue placeholder="Pilih tindakan..." />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="migration">Migrasi (Migration)</SelectItem>
                                <SelectItem value="conversion">Konversi (Conversion)</SelectItem>
                                <SelectItem value="encapsulation">Enkapsulasi (Encapsulation)</SelectItem>
                                <SelectItem value="emulation">Emulasi (Emulation)</SelectItem>
                                <SelectItem value="replication">Replikasi (Replication)</SelectItem>
                                <SelectItem value="refreshing">Penyegaran (Refreshing)</SelectItem>
                                <SelectItem value="backup">Backup Berkala</SelectItem>
                                <SelectItem value="integrity_check">Cek Integritas (Fixity Check)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {formData.action && formData.action !== 'integrity_check' && <ExternalPreservationFields
                        key={arsipId} electronicId={arsipId} data={formData} disabled={loading}
                        onChange={(field, value) => setFormData(previous => ({ ...previous, [field]: value }))} />}

                    <div className="space-y-2">
                        <Label htmlFor="details">Detail Teknis</Label>
                        <Textarea
                            id="details"
                            name="details"
                            value={formData.details}
                            onChange={handleChange}
                            placeholder="Jelaskan perubahan format, parameter, dan hasil pemeriksaan mutu."
                            maxLength={4000}
                            rows={3}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="notes">Catatan Tambahan</Label>
                        <Textarea
                            id="notes"
                            name="notes"
                            value={formData.notes}
                            onChange={handleChange}
                            placeholder="Catatan manual..."
                            rows={2}
                            maxLength={2000}
                        />
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                            Batal
                        </Button>
                        <Button type="submit" disabled={loading || !formData.action}>
                            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                            {formData.action === 'integrity_check' ? 'Jalankan cek integritas' : 'Simpan bukti tindakan eksternal'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function Loader2({ className }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
        >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
    );
}
