import { useId } from 'react'

// What a sinkron import may change; the server enforces the same list.
const FIELDS = {
    'surat-keluar': 'perihal, tanggal, sifat, tautan dokumen, dan jenis naskah',
    'surat-masuk': 'perihal, tanggal, dan jenis surat',
}

/**
 * Opt-in "sinkron": update letters already recorded in the unit when the
 * source changed them. Off by default; the server re-checks every letter.
 */
export default function ImportSyncOption({ type, checked, onChange, disabled }) {
    const id = useId()
    return <div className="flex items-start gap-3 rounded-lg border p-3">
        <input id={id} type="checkbox" className="mt-1 h-4 w-4" checked={checked} disabled={disabled}
            aria-describedby={`${id}-help`} onChange={event => onChange(event.target.checked)} />
        <div className="space-y-1">
            <label htmlFor={id} className="text-sm font-medium">Sinkronkan surat yang sudah tercatat</label>
            <p id={`${id}-help`} className="text-xs text-muted-foreground">
                Perbarui {FIELDS[type]} surat yang sudah tercatat di unit ini bila sumber mengubahnya.
                Sel kosong tidak menghapus data. Surat yang sedang atau telah disetujui, diarsipkan, dihapus, atau yang tidak boleh Anda ubah
                tetap seperti semula; setiap perubahan tercatat di log audit.
                {type === 'surat-masuk' && ' Sifat surat masuk tidak diubah karena menentukan klasifikasi keamanan.'}
            </p>
        </div>
    </div>
}
