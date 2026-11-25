// Kelompok grafik "Status Siklus Arsip" di Dashboard.
// Jumlah semua kelompok harus sama dengan kartu Total Arsip: arsip yang belum
// punya pemicu retensi masuk "Belum Ditentukan", dan arsip dalam penahanan
// hukum ditampilkan sebagai kelompok tersendiri bila ada.
const angka = (nilai) => {
    const hasil = Number(nilai)
    return Number.isFinite(hasil) && hasil > 0 ? hasil : 0
}

export function kelompokSiklusArsip(siklus) {
    const data = siklus || {}
    const kelompok = [
        { label: 'Aktif', value: angka(data.aktif), color: 'bg-emerald-500', warna: '#10b981' },
        { label: 'Inaktif', value: angka(data.inaktif), color: 'bg-blue-500', warna: '#3b82f6' },
        { label: 'Kadaluarsa', value: angka(data.kadaluarsa), color: 'bg-red-500', warna: '#ef4444' },
        {
            label: 'Belum Ditentukan',
            value: angka(data.belumDitentukan) + angka(data.missingTrigger),
            color: 'bg-slate-400',
            warna: '#94a3b8',
        },
    ]
    if (angka(data.held) > 0) {
        kelompok.push({ label: 'Penahanan hukum', value: angka(data.held), color: 'bg-amber-500', warna: '#f59e0b' })
    }
    return kelompok
}
