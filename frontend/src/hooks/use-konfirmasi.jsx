import { useCallback, useEffect, useRef, useState } from 'react';
import { DialogKonfirmasi } from '@/components/DialogKonfirmasi';

/**
 * Konfirmasi lewat dialog aplikasi sebagai pengganti window.confirm.
 *
 *   const [konfirmasi, dialogKonfirmasi] = useKonfirmasi();
 *   if (!(await konfirmasi({ judul, pesan, aksi: 'Simpan', batal: 'Kembali' }))) return;
 *   ...
 *   return <>{...}{dialogKonfirmasi}</>;
 *
 * Janji selalu selesai: true bila tombol aksi dipilih, false bila dibatalkan,
 * ditutup, digantikan permintaan baru, atau komponen dilepas.
 */
export function useKonfirmasi() {
    // Isi dialog tetap disimpan setelah dijawab agar teksnya tidak hilang
    // selama animasi penutupan.
    const [permintaan, setPermintaan] = useState({ terbuka: false, isi: null });
    const penjawabRef = useRef(null);

    const jawab = useCallback((nilai) => {
        const penjawab = penjawabRef.current;
        penjawabRef.current = null;
        setPermintaan((lama) => ({ ...lama, terbuka: false }));
        penjawab?.(nilai);
    }, []);

    const konfirmasi = useCallback((opsi) => new Promise((resolve) => {
        penjawabRef.current?.(false);
        penjawabRef.current = resolve;
        setPermintaan({ terbuka: true, isi: opsi });
    }), []);

    useEffect(() => () => {
        penjawabRef.current?.(false);
        penjawabRef.current = null;
    }, []);

    return [konfirmasi, <DialogKonfirmasi key="dialog-konfirmasi" terbuka={permintaan.terbuka} permintaan={permintaan.isi} onJawab={jawab} />];
}

export default useKonfirmasi;
