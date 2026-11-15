// Label layar untuk nilai kode pada rekod arsip. Nilai status mengikuti
// arsip.disposal_status yang ditulis penyusutan.service.ts di backend.
import { normalisasiKelas } from '@/lib/kelas-keamanan'

const STATUS_PENYUSUTAN = Object.freeze({
    active: 'Aktif',
    proposed_pindah: 'Diusulkan pindah',
    proposed_musnah: 'Diusulkan musnah',
    proposed_serah: 'Diusulkan serah',
    proposed_alih_media: 'Diusulkan alih media',
    approved: 'Penyusutan disetujui',
    executed: 'Penyusutan dilaksanakan',
})

/** Status penyusutan arsip; kosong berarti nilai bawaan (aktif). Kode yang tidak dikenal tidak ditampilkan mentah. */
export function labelStatusPenyusutan(status) {
    if (!status) return STATUS_PENYUSUTAN.active
    return STATUS_PENYUSUTAN[status] ?? 'Tidak diketahui'
}

const KELAS_KEAMANAN = Object.freeze({
    biasa: 'Biasa',
    terbatas: 'Terbatas',
    rahasia: 'Rahasia',
    sangat_rahasia: 'Sangat Rahasia',
})

/** Klasifikasi keamanan; kosong dibaca Biasa seperti di server. */
export function labelKelasKeamanan(kelas) {
    return KELAS_KEAMANAN[normalisasiKelas(kelas)] ?? 'Tidak diketahui'
}
