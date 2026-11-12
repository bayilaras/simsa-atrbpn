/**
 * Baris cetak Formulir 4 dan Formulir 6: satu baris per item arsip.
 *
 * Arsip yang punya rincian di arsip_items dicetak satu baris per item, dengan
 * kolom berkas dikelompokkan pada baris pertamanya. Arsip tanpa rincian item
 * tetap dicetak satu baris dari data berkasnya.
 */
export interface ItemFormulirArsip {
    nomorItem?: string | null;
    uraianItem?: string | null;
    tingkatPerkembangan?: string | null;
    tanggalItem?: string | null;
    jumlah?: number | null;
    lokasiFc?: string | null;
    lokasiLaci?: string | null;
    lokasiFolder?: string | null;
}

export interface BarisFormulirArsip {
    /** Baris arsip dari arsipService.findAll. */
    berkas: any;
    /** Urutan berkas dalam daftar, mulai dari 1. */
    urutBerkas: number;
    /** Posisi baris ini di dalam berkasnya, mulai dari 0. */
    itemKe: number;
    /** Jumlah baris yang dicetak untuk berkas ini. */
    jumlahBaris: number;
    /** Baris berasal dari rincian item, bukan dari ringkasan berkas. */
    dariItem: boolean;
    jumlahBerkas: number;
    nomorItem: string;
    uraianItem: string;
    tanggal: string;
    jumlah: number;
    tingkatPerkembangan: string;
    lokasi: string;
}

const lokasiDari = (sumber: Pick<ItemFormulirArsip, 'lokasiFc' | 'lokasiLaci' | 'lokasiFolder'>) =>
    [sumber.lokasiFc, sumber.lokasiLaci, sumber.lokasiFolder].filter(Boolean).join('/');

const urutNomorItem = (a: ItemFormulirArsip, b: ItemFormulirArsip) =>
    (a.nomorItem || '').localeCompare(b.nomorItem || '', 'id', { numeric: true });

export function barisFormulirArsip(
    data: any[],
    itemPerArsip: Map<string, ItemFormulirArsip[]>,
): BarisFormulirArsip[] {
    return data.flatMap((berkas, index): BarisFormulirArsip[] => {
        const urutBerkas = index + 1;
        const lokasiBerkas = lokasiDari(berkas);
        const items = [...(itemPerArsip.get(berkas.id) ?? [])].sort(urutNomorItem);
        if (items.length === 0) {
            const jumlah = berkas.jumlah || 1;
            return [{
                berkas, urutBerkas, itemKe: 0, jumlahBaris: 1, dariItem: false,
                jumlahBerkas: jumlah,
                nomorItem: berkas.nomorItem || '',
                uraianItem: berkas.uraianItem || '',
                tanggal: berkas.tanggalArsip || '',
                jumlah,
                tingkatPerkembangan: berkas.tingkatPerkembangan || '',
                lokasi: lokasiBerkas,
            }];
        }
        const jumlahBerkas = items.reduce((total, item) => total + (item.jumlah || 1), 0);
        return items.map((item, itemKe) => ({
            berkas, urutBerkas, itemKe, jumlahBaris: items.length, dariItem: true,
            jumlahBerkas,
            nomorItem: item.nomorItem || '',
            uraianItem: item.uraianItem || '',
            tanggal: item.tanggalItem || '',
            jumlah: item.jumlah || 1,
            tingkatPerkembangan: item.tingkatPerkembangan || berkas.tingkatPerkembangan || '',
            lokasi: lokasiDari(item) || lokasiBerkas,
        }));
    });
}

/** Kolom "Uraian Informasi Arsip/Berkas" Formulir 6 untuk satu baris. */
export function uraianFormulir6(baris: BarisFormulirArsip, pemisah: string): string {
    const berkas: string = baris.berkas.uraianBerkas || '';
    if (!baris.dariItem) return berkas || baris.uraianItem;
    if (!baris.uraianItem || baris.uraianItem === berkas) return berkas;
    if (!berkas) return baris.uraianItem;
    return `${baris.uraianItem}${pemisah}(Berkas: ${berkas})`;
}

/** Keterangan jumlah di kaki PDF: jumlah arsip, dan jumlah baris bila berbeda. */
export function totalFormulirArsip(jumlahArsip: number, jumlahBaris: number): string {
    return jumlahBaris === jumlahArsip
        ? `Total: ${jumlahArsip} arsip`
        : `Total: ${jumlahArsip} arsip, ${jumlahBaris} item`;
}
