import React, { useState } from 'react';
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

export default function PreservationActionForm({ arsipId, onSuccess }) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
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

        try {
            await api.post(`/arsip-elektronik/${arsipId}/preservasi`, formData);

            toast({
                title: 'Berhasil',
                description: 'Tindakan preservasi berhasil dicatat',
            });

            setOpen(false);
            setFormData({ action: '', details: '', notes: '' });
            if (onSuccess) onSuccess();
        } catch (error) {
            console.error('Error recording preservation action:', error);
            toast({
                title: 'Gagal',
                description: 'Gagal mencatat tindakan preservasi',
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
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Catat Tindakan Preservasi</DialogTitle>
                    <DialogDescription>
                        Catat tindakan pelestarian yang dilakukan pada arsip elektronik ini.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="action">Jenis Tindakan</Label>
                        <Select value={formData.action} onValueChange={handleSelectChange} required>
                            <SelectTrigger>
                                <SelectValue placeholder="Pilih tindakan..." />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="migration">Migrasi (Migration)</SelectItem>
                                <SelectItem value="conversion">Konversi (Conversion)</SelectItem>
                                <SelectItem value="emulation">Emulasi (Emulation)</SelectItem>
                                <SelectItem value="refreshing">Penyegaran (Refreshing)</SelectItem>
                                <SelectItem value="backup">Backup Berkala</SelectItem>
                                <SelectItem value="integrity_check">Cek Integritas (Fixity Check)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="details">Detail Teknis</Label>
                        <Textarea
                            id="details"
                            name="details"
                            value={formData.details}
                            onChange={handleChange}
                            placeholder='Contoh: {"format_asal": "doc", "format_tujuan": "pdf/a"}'
                            className="font-mono text-xs"
                            rows={3}
                        />
                        <p className="text-[10px] text-muted-foreground">
                            Format JSON disarankan untuk detail teknis.
                        </p>
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
                        />
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                            Batal
                        </Button>
                        <Button type="submit" disabled={loading}>
                            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                            Simpan
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
