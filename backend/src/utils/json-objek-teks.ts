/**
 * Multipart mengirim objek bersarang sebagai teks JSON. Teks yang (setelah
 * spasi di tepinya, termasuk NBSP dan BOM, dibuang) berbentuk objek JSON
 * diurai; selain itu nilai dikembalikan apa adanya. Dipakai validator dan
 * penyaring masukan, agar keduanya selalu membaca nilai yang sama.
 */
export function parseJsonObjectString(value: unknown): unknown {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed.startsWith('{')) return value;
    try {
        return JSON.parse(trimmed);
    } catch {
        return value;
    }
}
