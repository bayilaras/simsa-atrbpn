import { useEffect, useState } from 'react'
import { useNavigationType } from 'react-router-dom'
import { bacaKeadaanDaftar, kunciKeadaanDaftar, tulisKeadaanDaftar } from '@/lib/keadaan-daftar'

/**
 * Keadaan awal sebuah daftar. Mengembalikan keadaan tersimpan hanya bila
 * pengguna kembali ke daftar (navigasi POP: tombol Kembali, Back peramban, atau
 * muat ulang); membuka daftar dari menu atau tautan mengembalikan null sehingga
 * daftar mulai dari awal. Nilainya dibaca sekali saat halaman dipasang.
 */
export function useKeadaanDaftarAwal(userId, daftar) {
    const jenisNavigasi = useNavigationType()
    const [awal] = useState(() => (
        jenisNavigasi === 'POP'
            ? bacaKeadaanDaftar(kunciKeadaanDaftar({ userId, daftar }))
            : null
    ))
    return awal
}

/** Menyimpan keadaan daftar setiap kali berubah. `keadaan` harus dapat di-JSON-kan. */
export function useSimpanKeadaanDaftar(userId, daftar, keadaan) {
    const teks = JSON.stringify(keadaan)
    useEffect(() => {
        tulisKeadaanDaftar(kunciKeadaanDaftar({ userId, daftar }), JSON.parse(teks))
    }, [userId, daftar, teks])
}
