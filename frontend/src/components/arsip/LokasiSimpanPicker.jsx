import { useEffect, useState } from 'react'
import storageLocationService from '@/services/storage-location.service'
import { TANPA_LOKASI, daftarPilihanLokasi, namaJalurLokasi } from './lokasi-simpan'

/**
 * Pilihan lokasi simpan milik satu unit kerja. `lokasiTersimpan`
 * ({ id, code, jalur }) menjaga pilihan yang sudah tersimpan tetap tampil
 * walau daftar belum atau gagal dimuat.
 */
export function LokasiSimpanPicker({ id, unitKerjaId, value, onChange, disabled, lokasiTersimpan, className = '', ...rest }) {
    const [muatan, setMuatan] = useState({ unit: null, status: 'memuat', pilihan: [] })

    useEffect(() => {
        if (!unitKerjaId) return
        let aktif = true
        storageLocationService.getTree(unitKerjaId)
            .then(response => {
                if (!aktif) return
                if (!Array.isArray(response?.data)) throw new Error('Daftar lokasi simpan tidak lengkap.')
                setMuatan({ unit: unitKerjaId, status: 'siap', pilihan: daftarPilihanLokasi(response.data) })
            })
            .catch(() => {
                if (aktif) setMuatan({ unit: unitKerjaId, status: 'gagal', pilihan: [] })
            })
        return () => { aktif = false }
    }, [unitKerjaId])

    const status = muatan.unit === unitKerjaId ? muatan.status : 'memuat'
    const pilihan = muatan.unit === unitKerjaId ? muatan.pilihan : []
    const tersimpanDiLuarDaftar = lokasiTersimpan?.id && !pilihan.some(opsi => opsi.id === lokasiTersimpan.id)
        ? { id: lokasiTersimpan.id, label: namaJalurLokasi(lokasiTersimpan.jalur, lokasiTersimpan.code) || 'Lokasi tersimpan' }
        : null
    const semuaPilihan = tersimpanDiLuarDaftar ? [tersimpanDiLuarDaftar, ...pilihan] : pilihan
    const idStatus = `${id}-status`
    const pesanStatus = status === 'memuat' ? 'Memuat daftar lokasi simpan…'
        : status === 'gagal' ? 'Daftar lokasi simpan tidak dapat dimuat. Tutup lalu buka kembali formulir ini untuk mencoba lagi.'
            : pilihan.length === 0 ? 'Belum ada lokasi simpan untuk unit kerja ini. Tambahkan lebih dulu di menu Lokasi Simpan.'
                : ''

    return (
        <>
            <select
                {...rest}
                id={id}
                value={value || ''}
                onChange={event => onChange(event.target.value)}
                disabled={disabled || status === 'memuat'}
                aria-describedby={[rest['aria-describedby'], pesanStatus && idStatus].filter(Boolean).join(' ') || undefined}
                className={`min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
            >
                <option value="">{TANPA_LOKASI}</option>
                {semuaPilihan.map(opsi => <option key={opsi.id} value={opsi.id}>{opsi.label}</option>)}
            </select>
            {pesanStatus && (
                <p id={idStatus} role={status === 'gagal' ? 'alert' : 'status'} className="text-xs text-muted-foreground">{pesanStatus}</p>
            )}
        </>
    )
}

export default LokasiSimpanPicker
