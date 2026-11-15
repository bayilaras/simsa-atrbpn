import { useEffect, useState } from 'react';
import settingsService from '@/services/settings.service';

function daftarUnit(hasil) {
    if (Array.isArray(hasil)) return hasil;
    return Array.isArray(hasil?.data) ? hasil.data : [];
}

/**
 * Nama unit kerja untuk ditampilkan kepada petugas. Kode unit (mis. dir_bppt)
 * tidak pernah ditampilkan: selama daftar unit belum dimuat, atau bila unit
 * tidak ditemukan, hasilnya string kosong. Daftar unit memakai cache
 * settingsService, jadi beberapa pemakai berbagi satu permintaan.
 */
export function useNamaUnitKerja(unitKerjaId) {
    const [hasil, setHasil] = useState({ id: '', nama: '' });

    useEffect(() => {
        if (!unitKerjaId) return undefined;
        let aktif = true;
        Promise.resolve()
            .then(() => settingsService.getAllUnitKerja())
            .then((data) => {
                if (!aktif) return;
                const unit = daftarUnit(data).find((item) => item?.id === unitKerjaId);
                setHasil({ id: unitKerjaId, nama: unit?.name || unit?.nama || '' });
            })
            .catch(() => {
                if (aktif) setHasil({ id: unitKerjaId, nama: '' });
            });
        return () => { aktif = false; };
    }, [unitKerjaId]);

    return unitKerjaId && hasil.id === unitKerjaId ? hasil.nama : '';
}

export default useNamaUnitKerja;
