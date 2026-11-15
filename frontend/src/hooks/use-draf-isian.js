import { useCallback, useEffect, useRef, useState } from 'react';
import {
    bacaDrafIsian,
    generasiDrafIsian,
    hapusDrafIsian,
    kunciDrafIsian,
    tulisDrafIsian,
} from '@/lib/draf-isian';

/**
 * Draf isian formulir di sessionStorage tab ini (lihat lib/draf-isian.js).
 *
 *   const draf = useDrafIsian({ userId, formulir: 'surat-masuk', idRekod: id });
 *   draf.simpanDraf(isian)   // ditulis setelah jeda singkat
 *   draf.simpanSekarang()    // tulis yang tertunda sekarang (mis. sebelum mengirim)
 *   draf.bacaDraf()          // { disimpanPada, data } atau null
 *   draf.hapusDraf()         // setelah tersimpan, Batal, atau isian dibuang
 *   draf.status              // null | 'tersimpan' | 'dipulihkan'
 *
 * Penulisan yang tertunda ikut ditulis saat formulir ditutup atau halaman
 * ditinggalkan, kecuali pengguna sudah keluar (generasi draf berganti).
 */
export function useDrafIsian({ userId, formulir, idRekod, jedaMs = 800 }) {
    const kunci = kunciDrafIsian({ userId, formulir, idRekod });
    const [generasi] = useState(generasiDrafIsian);
    const [status, setStatus] = useState(null);
    const tertundaRef = useRef(null);
    const timerRef = useRef(null);

    const tulisTertunda = useCallback(() => {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        const tertunda = tertundaRef.current;
        tertundaRef.current = null;
        if (tertunda && tulisDrafIsian(tertunda.kunci, tertunda.data, generasi)) {
            setStatus('tersimpan');
        }
    }, [generasi]);

    const simpanDraf = useCallback((data) => {
        if (!kunci) return;
        tertundaRef.current = { kunci, data };
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(tulisTertunda, jedaMs);
    }, [jedaMs, kunci, tulisTertunda]);

    const bacaDraf = useCallback(() => bacaDrafIsian(kunci), [kunci]);

    const hapusDraf = useCallback(() => {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        tertundaRef.current = null;
        hapusDrafIsian(kunci);
        setStatus(null);
    }, [kunci]);

    const tandaiDipulihkan = useCallback(() => setStatus('dipulihkan'), []);

    useEffect(() => {
        window.addEventListener('pagehide', tulisTertunda);
        return () => {
            window.removeEventListener('pagehide', tulisTertunda);
            tulisTertunda();
        };
    }, [tulisTertunda]);

    return {
        simpanDraf,
        simpanSekarang: tulisTertunda,
        bacaDraf,
        hapusDraf,
        tandaiDipulihkan,
        status,
    };
}

export default useDrafIsian;
