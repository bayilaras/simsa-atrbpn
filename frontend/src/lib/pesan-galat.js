/** Pesan galat untuk pengguna dari galat `api.js` (message/data/response bergaya Axios), dengan cadangan. */
export function pesanGalat(err, cadangan) {
    return err?.data?.error || err?.response?.data?.error || err?.message || cadangan
}
