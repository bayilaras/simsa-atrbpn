import { useNavigate } from 'react-router-dom'
import { ChevronDown, ClipboardCheck, FileSignature, FileText, Inbox, Link2, Reply, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { buildTindakLanjutState } from '@/lib/tindak-lanjut'

/** Menu Tindak Lanjut (spec §7): item tampil sesuai aksiDiizinkan dari server, bukan canWrite(unit rekaman). */
export function TindakLanjutMenu({
    jenis, surat, aksiDiizinkan = [], onDisposisi, onTautkan, onTerima, onPenyelesaian,
    variant = 'secondary', className, label = 'Tindak Lanjut',
}) {
    const navigate = useNavigate()
    const aksi = new Set(aksiDiizinkan)
    const keForm = (jenisAksi) => navigate('/surat/keluar/tambah', { state: buildTindakLanjutState(jenis, surat, jenisAksi) })
    const items = [
        aksi.has('saya_balas') && { key: 'saya_balas', text: 'Saya Balas', Icon: Reply, onSelect: () => keForm('saya_balas') },
        aksi.has('buat_nota_dinas') && { key: 'buat_nota_dinas', text: 'Buat Nota Dinas', Icon: FileText, onSelect: () => keForm('buat_nota_dinas') },
        aksi.has('buat_nd_penjelas') && { key: 'buat_nd_penjelas', text: 'Buat ND Penjelas', Icon: FileSignature, onSelect: () => keForm('buat_nd_penjelas') },
        aksi.has('disposisi') && onDisposisi && { key: 'disposisi', text: 'Disposisi ke Direktorat', Icon: Send, onSelect: onDisposisi },
        aksi.has('terima') && onTerima && { key: 'terima', text: 'Terima Disposisi', Icon: Inbox, onSelect: onTerima },
        aksi.has('penyelesaian') && onPenyelesaian && { key: 'penyelesaian', text: 'Penyelesaian', Icon: ClipboardCheck, onSelect: onPenyelesaian },
        aksi.has('tautkan') && onTautkan && { key: 'tautkan', text: 'Tautkan ke Rangkaian', Icon: Link2, onSelect: onTautkan },
    ].filter(Boolean)
    if (items.length === 0) return null
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button type="button" variant={variant} className={className}>
                    {label}
                    <ChevronDown className="ml-2 h-4 w-4" aria-hidden="true" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
                {items.map(({ key, text, Icon, onSelect }) => (
                    <DropdownMenuItem key={key} onSelect={onSelect}>
                        <Icon className="mr-2 h-4 w-4" aria-hidden="true" />
                        {text}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
