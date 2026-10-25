import { useState } from 'react'
import { Loader2, Lock, Mail, Search, Sparkles, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { useLacakSearch } from '@/hooks/use-lacak-search'
import { JENIS_RELASI_LABEL } from '@/lib/tindak-lanjut'

const PLACEHOLDER = 'Ketik minimal 3 karakter nomor atau perihal...'

/**
 * Kartu Nomor Referensi (§7): inisiatif, chip terkunci (tindak lanjut), atau picker berbasis Lacak mode=referensi.
 * `autoOpen` hanya menentukan nilai awal `open` (useState); untuk memaksa reopen setelah mount, remount lewat `key`.
 * `relasiTetap` menyembunyikan pemilih "Jenis relasi" untuk konsumen yang jenis relasinya selalu ditetapkan server (Task 24).
 */
export function ReferensiSection({
    mode, referensi, onPilih, onHapus, onUbahRelasi, disabled = false, autoOpen = false, jenisFilter, label = 'Nomor Referensi', relasiTetap = false,
}) {
    const [open, setOpen] = useState(autoOpen)
    const [term, setTerm] = useState('')
    const { loading, error, data, retry } = useLacakSearch(term, { mode: 'referensi', jenis: jenisFilter, enabled: open })

    if (mode === 'inisiatif') {
        return (
            <div role="status" className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:bg-emerald-500/15">
                <Sparkles className="h-5 w-5 text-emerald-600" aria-hidden="true" />
                <div className="space-y-1">
                    <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:text-emerald-300">Inisiatif</Badge>
                    <p className="text-sm font-medium">Inisiatif: memulai rangkaian baru</p>
                    <p className="text-xs text-muted-foreground">Surat ini tidak merujuk surat lain. Surat terkait dapat ditautkan kemudian.</p>
                </div>
            </div>
        )
    }

    if (referensi) {
        return (
            <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 dark:bg-blue-500/15">
                <Mail className="h-5 w-5 flex-shrink-0 text-blue-600" aria-hidden="true" />
                <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">{label}</p>
                    <p className="font-medium text-blue-900 dark:text-blue-300">{referensi.nomorSurat || 'Tanpa Nomor'}</p>
                    <p className="truncate text-sm text-blue-700 dark:text-blue-300">{referensi.perihal}</p>
                    {referensi.rangkaianKode && <Badge variant="outline">{referensi.rangkaianKode}</Badge>}
                </div>
                {referensi.terkunci ? (
                    <Lock className="h-4 w-4 flex-shrink-0 text-blue-600" aria-label="Nomor Referensi terkunci" role="img" />
                ) : (
                    <div className="flex flex-shrink-0 items-center gap-2">
                        {!relasiTetap && (
                            <select
                                aria-label="Jenis relasi"
                                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                                value={referensi.jenisRelasi}
                                onChange={(event) => onUbahRelasi?.(event.target.value)}
                                disabled={disabled}
                            >
                                {Object.entries(JENIS_RELASI_LABEL).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                            </select>
                        )}
                        <Button type="button" variant="ghost" size="sm" onClick={onHapus} disabled={disabled}>
                            <X className="h-4 w-4" aria-hidden="true" />
                            <span className="sr-only">Hapus surat rujukan yang dipilih</span>
                        </Button>
                    </div>
                )}
            </div>
        )
    }

    const kelompok = data?.kelompok ?? []
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button type="button" variant="outline" role="combobox" aria-label={label} aria-expanded={open} disabled={disabled}
                    className="h-12 w-full justify-start border-dashed text-muted-foreground hover:border-solid">
                    <Search className="mr-2 h-4 w-4" aria-hidden="true" />
                    <span>Cari nomor atau perihal surat rujukan...</span>
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0 sm:w-[520px]" align="start">
                <Command shouldFilter={false}>
                    <CommandInput placeholder={PLACEHOLDER} value={term} onValueChange={setTerm} />
                    <CommandList>
                        {error ? (
                            <div className="space-y-2 p-4">
                                <p role="alert" className="text-sm text-destructive">{error.message || 'Pencarian gagal'}</p>
                                <Button type="button" variant="link" className="h-auto p-0 text-sm" onClick={retry}>Coba lagi</Button>
                            </div>
                        ) : (
                            <CommandEmpty>
                                {loading ? (
                                    <span className="flex items-center justify-center gap-2 py-6 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Memuat...</span>
                                ) : (
                                    <span className="block py-6 text-center text-sm text-muted-foreground">
                                        {term.trim().length < 3 ? 'Ketik minimal 3 karakter' : 'Tidak ada surat yang cocok'}
                                    </span>
                                )}
                            </CommandEmpty>
                        )}
                        {kelompok.map((grup) => (
                            <CommandGroup key={grup.kunci} heading={grup.rangkaian ? `${grup.rangkaian.kode} · ${grup.rangkaian.tahun}` : 'Surat tunggal'}>
                                {grup.pratinjau.filter((n) => !n.masked).map((n) => (
                                    <CommandItem
                                        key={`${n.jenis}:${n.id}`}
                                        value={`${n.jenis}:${n.id}`}
                                        onSelect={() => {
                                            onPilih({
                                                jenis: n.jenis, suratId: n.id, nomorSurat: n.nomorSurat, perihal: n.perihal,
                                                unitKerjaId: n.unitKerjaId, unitNama: n.unitNama, rangkaianKode: grup.rangkaian?.kode ?? null,
                                                jenisRelasi: n.jenis === 'surat_masuk' ? 'balasan' : 'tindak_lanjut', terkunci: false,
                                            })
                                            setOpen(false)
                                            setTerm('')
                                        }}
                                        className="cursor-pointer py-3"
                                    >
                                        <div className="min-w-0">
                                            <p className="truncate font-medium">{n.nomorSurat || '-'}</p>
                                            <p className="truncate text-sm text-muted-foreground">{n.perihal}</p>
                                            <p className="text-xs text-muted-foreground">{n.jenis === 'surat_masuk' ? 'Surat masuk' : 'Surat keluar'} · {n.unitNama} · {n.tahun}</p>
                                        </div>
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        ))}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}
