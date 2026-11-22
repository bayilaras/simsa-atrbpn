/**
 * Batas min/max pada isian membuat peramban menahan formulir dengan balonnya sendiri (dalam bahasa peramban)
 * sebelum handler submit berjalan. Pasang hasil fungsi ini pada onInvalid agar pesan aplikasi yang tampil.
 * Bila galatUntuk mengembalikan null (mis. isian wajib yang kosong), penandaan peramban dibiarkan.
 */
export function gantiPesanPeramban(galatUntuk, tampilkan) {
    return (event) => {
        const isian = event.target
        const galat = galatUntuk(isian.value)
        if (!galat) return
        event.preventDefault()
        tampilkan(galat)
        // Peramban tidak lagi memfokuskan isian yang balonnya dibatalkan; fokuskan bila ini isian tak sah pertama.
        const pertama = Array.from(isian.form?.elements ?? []).find(el => el.willValidate && !el.validity.valid)
        if (pertama === isian) isian.focus()
    }
}
