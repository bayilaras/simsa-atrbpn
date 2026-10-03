/**
 * Pesan galat untuk pengguna dari galat `api.js` (message/data/response bergaya Axios), dengan cadangan.
 * Backend (`publicErrorResponse`) mengirim `error` = nama kelas (mis. 'ConflictError') dan `message` =
 * pesan domain; karena itu `message` selalu didahulukan, `error` hanya pilihan terakhir sebelum cadangan.
 */
export function pesanGalat(err, cadangan) {
    return err?.data?.message
        || err?.response?.data?.message
        || err?.message
        || err?.data?.error
        || err?.response?.data?.error
        || cadangan
}
