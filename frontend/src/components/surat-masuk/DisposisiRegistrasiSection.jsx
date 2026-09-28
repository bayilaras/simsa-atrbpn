import { ArrowRight } from 'lucide-react'
import { MultiSelect } from '@/components/ui/multi-select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { appendInstruksi } from '@/lib/tindak-lanjut'
import { KABAG_LABELS, LEGACY_DISPOSISI_LABELS } from '@/lib/disposisi-labels'

/**
 * Disposisi pada registrasi surat masuk (§7): create memakai unit tujuan nyata (D6: Kabag hanya
 * chip label) dengan penanggung jawab, batas waktu dan instruksi; edit mempertahankan label lama
 * (`LEGACY_DISPOSISI_LABELS`) tanpa struktur unit, karena disposisi surat lama tidak diubah menjadi
 * target ber-unit lewat form ini.
 */
export function DisposisiRegistrasiSection({
    isEditMode, units, value, onChange, penanggungJawab, onPenanggungJawab, batasWaktu, onBatasWaktu,
    instruksi, onInstruksi, opsiInstruksi = [], disabled, error, errorId = 'disposisi-surat-error',
}) {
    const options = isEditMode
        ? Array.from(new Set([...LEGACY_DISPOSISI_LABELS, ...value])).map((label) => ({ label, value: label }))
        : [
            ...units.map((unit) => ({ label: unit.name, value: unit.id })),
            ...KABAG_LABELS.map((label) => ({ label: `${label} (label saja)`, value: label })),
        ]
    const unitDipilih = isEditMode ? [] : value.filter((item) => units.some((unit) => unit.id === item))
    const tambahInstruksi = (teks) => onInstruksi(appendInstruksi(instruksi, teks))

    return (
        <div className="space-y-3">
            <Label htmlFor="disposisi-surat" className="text-sm font-medium flex items-center gap-2">
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                Disposisi ke
            </Label>
            <MultiSelect
                id="disposisi-surat"
                ariaLabel="Penerima disposisi"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined}
                disabled={disabled}
                options={options}
                selected={value}
                onChange={onChange}
                placeholder={isEditMode ? 'Label disposisi...' : 'Pilih unit tujuan disposisi...'}
                className="w-full focus-visible:ring-primary"
            />
            {error && <p id={errorId} className="text-sm text-destructive">{error}</p>}
            {unitDipilih.length > 0 && (
                <div className="space-y-3 rounded-lg border border-border/60 p-3">
                    <fieldset className="space-y-1" disabled={disabled}>
                        <legend className="text-sm font-medium">Penanggung jawab (Unit Pengolah)</legend>
                        {unitDipilih.map((id) => (
                            <label key={id} className="flex items-center gap-2 text-sm">
                                <input type="radio" name="penanggung-jawab-registrasi" checked={penanggungJawab === id} onChange={() => onPenanggungJawab(id)} />
                                {units.find((unit) => unit.id === id)?.name || id}
                            </label>
                        ))}
                    </fieldset>
                    <div className="space-y-1">
                        <Label htmlFor="batas-waktu-registrasi">Batas waktu</Label>
                        <Input id="batas-waktu-registrasi" type="date" value={batasWaktu} onChange={(event) => onBatasWaktu(event.target.value)} disabled={disabled} />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="instruksi-registrasi">Instruksi disposisi</Label>
                        {opsiInstruksi.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {opsiInstruksi.map((teks) => (
                                    <Button key={teks} type="button" size="sm" variant="outline" onClick={() => tambahInstruksi(teks)} disabled={disabled}>{teks}</Button>
                                ))}
                            </div>
                        )}
                        <Textarea id="instruksi-registrasi" value={instruksi} onChange={(event) => onInstruksi(event.target.value)} rows={3} disabled={disabled} />
                    </div>
                </div>
            )}
        </div>
    )
}
