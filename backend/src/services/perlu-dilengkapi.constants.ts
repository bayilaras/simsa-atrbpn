// backend/src/services/perlu-dilengkapi.constants.ts
/** D7: kode kategori Perlu Dilengkapi. API, validator, dan UI memakai daftar yang sama. Sengaja tanpa impor. */
export const KATEGORI_PERLU_DILENGKAPI = [
    'sm_belum_ditindaklanjuti',
    'disposisi_terbuka',
    'sk_tanpa_nd_penjelas',
    'tindak_lanjut_tertahan',
    'siap_diberkaskan',
    'sk_tanpa_asal',
] as const;
export type KategoriPerluDilengkapi = typeof KATEGORI_PERLU_DILENGKAPI[number];
